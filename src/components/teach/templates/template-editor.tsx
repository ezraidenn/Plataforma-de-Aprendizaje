"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Ban,
  BookOpen,
  CalendarClock,
  CalendarDays,
  Check,
  Eye,
  EyeOff,
  FileDown,
  GraduationCap,
  Hash,
  Info,
  Loader2,
  FileBadge,
  Medal,
  Plus,
  QrCode,
  Trash2,
  TriangleAlert,
  Type,
  Upload,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { DECOR_PRESETS, getDecorPreset } from "@/lib/certificate-decor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { HelpTip } from "@/components/help/help-tip";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  renderTestPdfAction,
  updateTemplateAction,
} from "@/server/actions/teacher-templates";
import { DecorOverlay } from "./decor-overlay";
import { AlignToolbar } from "./align-toolbar";
import { CanvasGuides, CanvasRulers } from "./canvas-overlays";
import {
  alignDeltas,
  computeSnap,
  distributeDeltas,
  fieldBox,
  measures as computeMeasures,
  ptToMm,
  type AlignOp,
  type Guide,
  type Measure,
  type Rect,
} from "./canvas-geometry";

// ─── Tipos (espejo estructural de TemplateField del servidor) ────────────────

export type EditorFieldKey =
  | "student_name"
  | "course_title"
  | "date"
  | "score"
  | "folio"
  | "qr"
  | "teacher_name"
  | "validity"
  | "custom_text";

export type EditorField = {
  key: EditorFieldKey;
  /** Puntos PDF desde la esquina SUPERIOR izquierda */
  x: number;
  y: number;
  /** qr: lado en puntos; texto: tamaño de fuente */
  fontSize: number;
  font: "helvetica" | "helvetica_bold" | "times" | "times_bold";
  color: string;
  align: "left" | "center" | "right";
  text?: string;
  maxWidth?: number;
  /** false = queda en la plantilla pero NO se imprime (el server lo salta) */
  enabled?: boolean;
};

export type PageDims = Record<
  "letter" | "a4",
  Record<"landscape" | "portrait", readonly number[]>
>;

type Background = { fileId: string; name: string; isPdf: boolean } | null;

// ─── Constantes ──────────────────────────────────────────────────────────────

const CANVAS_W = 700;
const SNAP_TOLERANCE_PT = 6;
/** Margen "seguro" de página para guías y alineación (≈12.7 mm) */
const PAGE_MARGIN_PT = 36;
const GRID_PT = 14.17; // 5 mm
const RULER_PX = 22;

const FIELD_LABELS: Record<EditorFieldKey, string> = {
  student_name: "Nombre del estudiante",
  course_title: "Título del curso",
  date: "Fecha",
  score: "Calificación",
  folio: "Folio",
  qr: "Código QR",
  teacher_name: "Nombre del instructor",
  validity: "Vigencia",
  custom_text: "Texto libre",
};

const FIELD_ICONS: Record<EditorFieldKey, LucideIcon> = {
  student_name: GraduationCap,
  course_title: BookOpen,
  date: CalendarDays,
  score: Medal,
  folio: Hash,
  qr: QrCode,
  teacher_name: UserRound,
  validity: CalendarClock,
  custom_text: Type,
};

/** Campos que ofrece el menú «+ Agregar campo» (según la fase actual). */
const ADDABLE_KEYS: EditorFieldKey[] = [
  "student_name",
  "course_title",
  "date",
  "validity",
  "teacher_name",
  "folio",
  "qr",
  "custom_text",
];

const FONT_LABELS: Record<EditorField["font"], string> = {
  helvetica: "Helvetica",
  helvetica_bold: "Helvetica Bold",
  times: "Times",
  times_bold: "Times Bold",
};

const FONT_CSS: Record<
  EditorField["font"],
  { family: string; weight: number }
> = {
  helvetica: { family: "Helvetica, Arial, sans-serif", weight: 400 },
  helvetica_bold: { family: "Helvetica, Arial, sans-serif", weight: 700 },
  times: { family: "'Times New Roman', Times, serif", weight: 400 },
  times_bold: { family: "'Times New Roman', Times, serif", weight: 700 },
};

/**
 * Anclaje vertical fiel al PDF. El servidor ancla el TOP del glifo en field.y
 * bajando la baseline exactamente el ascent AFM de las Standard 14
 * (Ascender/1000 → Helvetica 0.718 em, Times 0.683, Times Bold 0.676).
 * En CSS, con line-height: 1 la baseline queda a 0.5 + (asc − desc)/2 em del
 * top de la caja (métricas del font del navegador). El span interior sube la
 * DIFERENCIA para que ambas baselines coincidan.
 */
const PDF_ASCENT_EM: Record<EditorField["font"], number> = {
  helvetica: 0.718,
  helvetica_bold: 0.718,
  times: 0.683,
  times_bold: 0.676,
};

/** Fallback con métricas de Arial / Times New Roman (Windows) si el navegador
 *  no expone fontBoundingBox en TextMetrics. */
const FALLBACK_SHIFT_EM: Record<EditorField["font"], number> = {
  helvetica: 0.129,
  helvetica_bold: 0.129,
  times: 0.154,
  times_bold: 0.161,
};

const SAMPLE_NAMES = {
  short: "Ana Ruiz",
  medium: "Laura Pérez Domínguez",
  long: "María Fernanda de los Ángeles Gutiérrez Bustamante",
} as const;

type SampleKey = keyof typeof SAMPLE_NAMES;

const OVERFLOW_HINT =
  "Este texto no cabe a ese tamaño: el PDF reduce la fuente hasta que quepa";
const TOGGLE_LABEL = "Mostrar u ocultar en el certificado";

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

// ─── Medición de texto (misma reducción automática que el server) ────────────

let measureCtx: CanvasRenderingContext2D | null = null;

/** Ancho del texto con el font CSS del lienzo; heurística en SSR/pre-montaje. */
function measureTextWidth(
  text: string,
  font: EditorField["font"],
  size: number,
  precise: boolean,
): number {
  if (precise && typeof document !== "undefined") {
    measureCtx ??= document.createElement("canvas").getContext("2d");
    if (measureCtx) {
      const css = FONT_CSS[font];
      measureCtx.font = `${css.weight} ${size}px ${css.family}`;
      return measureCtx.measureText(text).width;
    }
  }
  return text.length * size * 0.55;
}

/** Igual que el server: reduce la fuente hasta caber en maxWidth, mínimo 8. */
function effectiveFontSize(
  field: EditorField,
  text: string,
  precise: boolean,
): number {
  let size = field.fontSize;
  if (field.key === "qr" || !field.maxWidth || !text) return size;
  while (
    size > 8 &&
    measureTextWidth(text, field.font, size, precise) > field.maxWidth
  ) {
    size -= 1;
  }
  return size;
}

/** Puntos café en las esquinas del campo seleccionado (solo decorativos). */
function SelectionHandles() {
  return (
    <>
      <span
        className="pointer-events-none absolute -left-1 -top-1 size-1.5 rounded-full border border-white bg-primary"
        aria-hidden
      />
      <span
        className="pointer-events-none absolute -right-1 -top-1 size-1.5 rounded-full border border-white bg-primary"
        aria-hidden
      />
      <span
        className="pointer-events-none absolute -bottom-1 -left-1 size-1.5 rounded-full border border-white bg-primary"
        aria-hidden
      />
      <span
        className="pointer-events-none absolute -bottom-1 -right-1 size-1.5 rounded-full border border-white bg-primary"
        aria-hidden
      />
    </>
  );
}

function displayText(field: EditorField, sampleName: string): string {
  switch (field.key) {
    case "student_name":
      return sampleName;
    case "course_title":
      return "Seguridad Industrial";
    case "date":
      return "12 de marzo de 2026";
    case "score":
      return "95";
    case "folio":
      return "Folio: CERT-2026-000123-K7QX";
    case "teacher_name":
      return "Prof. Roberto Martínez";
    case "validity":
      return "Vigente hasta el 31 de diciembre de 2026";
    case "custom_text":
      return field.text ?? "Texto";
    case "qr":
      return "QR";
  }
}

/** Desborde = el texto no cabe al tamaño elegido (el PDF reducirá la fuente). */
function isOverflowing(
  field: EditorField,
  sampleName: string,
  precise: boolean,
): boolean {
  if (
    field.key === "qr" ||
    field.maxWidth === undefined ||
    field.enabled === false
  )
    return false;
  const text = displayText(field, sampleName);
  return effectiveFontSize(field, text, precise) < field.fontSize;
}

function defaultsFor(
  key: EditorFieldKey,
  pageW: number,
  pageH: number,
): EditorField {
  const cx = Math.round(pageW / 2);
  const cy = Math.round(pageH / 2);
  switch (key) {
    case "student_name":
      return {
        key,
        x: cx,
        y: cy - 40,
        fontSize: 32,
        font: "times_bold",
        color: "#1e1b4b",
        align: "center",
        maxWidth: 600,
      };
    case "course_title":
      return {
        key,
        x: cx,
        y: cy + 20,
        fontSize: 22,
        font: "helvetica",
        color: "#1e1b4b",
        align: "center",
        maxWidth: 600,
      };
    case "date":
      return {
        key,
        x: cx,
        y: cy + 80,
        fontSize: 14,
        font: "helvetica",
        color: "#475569",
        align: "center",
      };
    case "validity":
      // Debajo de la fecha por defecto (addField la ancla a la fecha real)
      return {
        key,
        x: cx,
        y: cy + 102,
        fontSize: 12,
        font: "helvetica",
        color: "#475569",
        align: "center",
        maxWidth: 500,
      };
    case "score":
      return {
        key,
        x: cx,
        y: cy + 110,
        fontSize: 14,
        font: "helvetica",
        color: "#475569",
        align: "center",
      };
    case "teacher_name":
      return {
        key,
        x: cx,
        y: Math.round(pageH * 0.78),
        fontSize: 14,
        font: "times_bold",
        color: "#1e1b4b",
        align: "center",
        maxWidth: 400,
      };
    case "folio":
      return {
        key,
        x: cx,
        y: pageH - 50,
        fontSize: 10,
        font: "helvetica",
        color: "#475569",
        align: "center",
      };
    case "qr":
      return {
        key,
        x: cx - 40,
        y: cy - 40,
        fontSize: 80,
        font: "helvetica",
        color: "#000000",
        align: "left",
      };
    case "custom_text":
      return {
        key,
        x: cx,
        y: cy - 100,
        fontSize: 16,
        font: "helvetica",
        color: "#1e1b4b",
        align: "center",
        text: "Texto",
      };
  }
}

// ─── Editor ──────────────────────────────────────────────────────────────────

export function TemplateEditor({
  template,
  background: initialBackground,
  pageSizes,
}: {
  template: {
    id: string;
    name: string;
    pageSize: "letter" | "a4";
    orientation: "landscape" | "portrait";
    fields: EditorField[];
    /** id del preset de adornos (lib/certificate-decor) o null = sin adornos */
    decor: string | null;
  };
  background: Background;
  pageSizes: PageDims;
}) {
  const [name, setName] = useState(template.name);
  const [pageSize, setPageSize] = useState(template.pageSize);
  const [orientation, setOrientation] = useState(template.orientation);
  const [fields, setFields] = useState<EditorField[]>(template.fields);
  const [decor, setDecor] = useState<string | null>(template.decor);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [background, setBackground] = useState<Background>(initialBackground);
  const [sample, setSample] = useState<SampleKey>("long");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(
    "idle",
  );
  const [uploadingBg, setUploadingBg] = useState(false);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [liveMeasures, setLiveMeasures] = useState<Measure[]>([]);
  /** Selección múltiple (Shift+clic); selectedIndex es el principal */
  const [multi, setMulti] = useState<Set<number>>(() => new Set());
  const [snapOn, setSnapOn] = useState(true);
  const [showGrid, setShowGrid] = useState(false);
  const [showRulers, setShowRulers] = useState(true);
  const [history, setHistory] = useState<{
    past: EditorField[][];
    future: EditorField[][];
  }>({ past: [], future: [] });
  const [saving, startSaving] = useTransition();
  const [generating, startGenerating] = useTransition();

  // Métricas reales del navegador (medidas tras montar para no romper la
  // hidratación): mounted habilita canvas.measureText y el ajuste de baseline.
  const [mounted, setMounted] = useState(false);
  const [fontShifts, setFontShifts] =
    useState<Record<EditorField["font"], number>>(FALLBACK_SHIFT_EM);

  useEffect(() => {
    setMounted(true);
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return;
    const next = { ...FALLBACK_SHIFT_EM };
    for (const font of Object.keys(FONT_CSS) as EditorField["font"][]) {
      const css = FONT_CSS[font];
      ctx.font = `${css.weight} 100px ${css.family}`;
      const m = ctx.measureText("Hg");
      if (
        typeof m.fontBoundingBoxAscent === "number" &&
        m.fontBoundingBoxAscent > 0
      ) {
        // baseline CSS (line-height 1) − baseline PDF, en em (medido a 100px)
        next[font] =
          0.5 +
          (m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 200 -
          PDF_ASCENT_EM[font];
      }
    }
    setFontShifts(next);
  }, []);

  const bgInputRef = useRef<HTMLInputElement>(null);
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;
  const dragRef = useRef<{
    pointerId: number;
    index: number;
    startClientX: number;
    startClientY: number;
    /** Posiciones originales de TODOS los campos seleccionados */
    orig: Map<number, { x: number; y: number }>;
    moved: boolean;
  } | null>(null);

  const dims = pageSizes[pageSize][orientation];
  const pageW = dims[0];
  const pageH = dims[1];
  const scale = CANVAS_W / pageW;
  const sampleName = SAMPLE_NAMES[sample];
  const selected =
    selectedIndex !== null ? (fields[selectedIndex] ?? null) : null;
  const anyOverflow = fields.some((f) => isOverflowing(f, sampleName, mounted));
  const activePreset = getDecorPreset(decor);

  function updateField(index: number, patch: Partial<EditorField>) {
    setFields((prev) =>
      prev.map((f, i) => (i === index ? { ...f, ...patch } : f)),
    );
    setSaveState("idle");
  }

  // ── Guardado ───────────────────────────────────────────────────────────────

  async function saveAllInner(): Promise<boolean> {
    setSaveState("saving");
    const result = await updateTemplateAction(template.id, {
      name,
      pageSize,
      orientation,
      fields: fieldsRef.current,
      decor,
    });
    if ("error" in result) {
      toast.error(result.error);
      setSaveState("idle");
      return false;
    }
    setSaveState("saved");
    return true;
  }

  function saveAll() {
    startSaving(async () => {
      if (await saveAllInner()) toast.success("Plantilla guardada");
    });
  }

  /** Autosave de campos (arrastre, toggle de visibilidad). */
  function persistFields() {
    startSaving(async () => {
      setSaveState("saving");
      const result = await updateTemplateAction(template.id, {
        fields: fieldsRef.current,
      });
      if ("error" in result) {
        toast.error(result.error);
        setSaveState("idle");
        return;
      }
      setSaveState("saved");
    });
  }

  /** Autosave del preset de adornos (mismo flujo que el resto). */
  function selectDecor(id: string | null) {
    if (id === decor) return;
    setDecor(id);
    startSaving(async () => {
      setSaveState("saving");
      const result = await updateTemplateAction(template.id, { decor: id });
      if ("error" in result) {
        toast.error(result.error);
        setSaveState("idle");
        return;
      }
      setSaveState("saved");
    });
  }

  // ── PDF de prueba (guarda primero: lo que ves es lo que se emite) ──────────

  function generateTestPdf() {
    startGenerating(async () => {
      if (!(await saveAllInner())) return;
      const result = await renderTestPdfAction(template.id, sampleName);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      const bytes = Uint8Array.from(atob(result.base64), (c) =>
        c.charCodeAt(0),
      );
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const win = window.open(url, "_blank");
      if (!win) {
        // Popup bloqueado: descarga directa
        const a = document.createElement("a");
        a.href = url;
        a.download = "certificado-prueba.pdf";
        a.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    });
  }

  // ── Fondo ──────────────────────────────────────────────────────────────────

  async function handleBgFile(file: File) {
    const ext = file.name.toLowerCase().split(".").pop() ?? "";
    if (!["pdf", "png", "jpg", "jpeg"].includes(ext)) {
      toast.error("Formato no soportado: sube un PDF, PNG o JPG");
      return;
    }
    setUploadingBg(true);
    try {
      const res = await fetch("/api/uploads", {
        method: "POST",
        headers: {
          "X-File-Name": encodeURIComponent(file.name),
          "X-File-Kind": "template_bg",
          "Content-Type": file.type || "application/octet-stream",
        },
        body: file,
      });
      const data = (await res.json()) as { fileId?: string; error?: string };
      if (!res.ok || !data.fileId) {
        toast.error(
          data.error ??
            "No se pudo subir el archivo. Revisa tu conexión con el servidor.",
        );
        return;
      }
      const result = await updateTemplateAction(template.id, {
        backgroundFileId: data.fileId,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setBackground({
        fileId: data.fileId,
        name: file.name,
        isPdf: ext === "pdf",
      });
      toast.success("Fondo actualizado");
    } catch {
      toast.error(
        "No se pudo subir el archivo. Revisa tu conexión con el servidor.",
      );
    } finally {
      setUploadingBg(false);
      if (bgInputRef.current) bgInputRef.current.value = "";
    }
  }

  // ── Selección, historial y geometría ───────────────────────────────────────

  const selectedSet = (() => {
    const s = new Set(multi);
    if (selectedIndex !== null) s.add(selectedIndex);
    return s;
  })();

  function selectOnly(index: number | null) {
    setSelectedIndex(index);
    setMulti(new Set());
  }

  function toggleInSelection(index: number) {
    const next = new Set(selectedSet);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    const arr = Array.from(next);
    setSelectedIndex(arr.length ? arr[arr.length - 1] : null);
    setMulti(new Set(arr));
  }

  /** Guarda el estado actual en el historial (antes de una mutación). */
  function pushHistory() {
    const snapshot = fieldsRef.current.map((f) => ({ ...f }));
    setHistory((h) => ({ past: [...h.past.slice(-49), snapshot], future: [] }));
  }

  function undo() {
    setHistory((h) => {
      const prev = h.past[h.past.length - 1];
      if (!prev) return h;
      const current = fieldsRef.current.map((f) => ({ ...f }));
      setFields(prev);
      fieldsRef.current = prev;
      setSaveState("idle");
      return {
        past: h.past.slice(0, -1),
        future: [current, ...h.future].slice(0, 50),
      };
    });
  }

  function redo() {
    setHistory((h) => {
      const next = h.future[0];
      if (!next) return h;
      const current = fieldsRef.current.map((f) => ({ ...f }));
      setFields(next);
      fieldsRef.current = next;
      setSaveState("idle");
      return {
        past: [...h.past, current].slice(-50),
        future: h.future.slice(1),
      };
    });
  }

  /** Caja en puntos de un campo (misma geometría que el lienzo y el PDF). */
  const rectOf = useCallback(
    (field: EditorField): Rect => {
      if (field.key === "qr") {
        const side = Math.max(40, field.fontSize);
        return fieldBox({
          x: field.x,
          y: field.y,
          align: "left",
          width: side,
          height: side,
        });
      }
      const text = displayText(field, sampleName);
      const size = effectiveFontSize(field, text, mounted);
      const width = measureTextWidth(text, field.font, size, mounted);
      return fieldBox({
        x: field.x,
        y: field.y,
        align: field.align,
        width,
        height: size,
      });
    },
    [sampleName, mounted],
  );

  /** Aplica desplazamientos por índice (alineación, distribución, teclado). */
  function applyDeltas(deltas: Map<number, { dx: number; dy: number }>) {
    if (deltas.size === 0) return;
    pushHistory();
    const next = fieldsRef.current.map((f, i) => {
      const d = deltas.get(i);
      if (!d) return f;
      return {
        ...f,
        x: clamp(Math.round(f.x + d.dx), 0, pageW),
        y: clamp(Math.round(f.y + d.dy), 0, pageH),
      };
    });
    setFields(next);
    fieldsRef.current = next;
    persistFields();
  }

  function alignSelection(op: AlignOp) {
    const rects = Array.from(selectedSet).map((index) => ({
      index,
      rect: rectOf(fieldsRef.current[index]),
    }));
    applyDeltas(alignDeltas(rects, op, pageW, pageH, PAGE_MARGIN_PT));
  }

  function distributeSelection(axis: "x" | "y") {
    const rects = Array.from(selectedSet).map((index) => ({
      index,
      rect: rectOf(fieldsRef.current[index]),
    }));
    if (rects.length < 3) {
      toast.info("Selecciona al menos 3 campos (Shift + clic) para distribuir");
      return;
    }
    applyDeltas(distributeDeltas(rects, axis));
  }

  function duplicateSelection() {
    if (selectedSet.size === 0) return;
    const copies: EditorField[] = [];
    for (const i of selectedSet) {
      const f = fieldsRef.current[i];
      // Los campos únicos (nombre, folio, QR…) no se duplican; el texto libre sí
      if (!f || f.key !== "custom_text") continue;
      copies.push({
        ...f,
        x: clamp(f.x + 20, 0, pageW),
        y: clamp(f.y + 20, 0, pageH),
      });
    }
    if (copies.length === 0) {
      toast.info(
        "Solo el «Texto libre» se puede duplicar; los demás campos son únicos",
      );
      return;
    }
    pushHistory();
    const next = [...fieldsRef.current, ...copies];
    setFields(next);
    fieldsRef.current = next;
    const idx = copies.map((_, k) => next.length - copies.length + k);
    setSelectedIndex(idx[idx.length - 1]);
    setMulti(new Set(idx));
    persistFields();
  }

  function removeSelection() {
    if (selectedSet.size === 0) return;
    pushHistory();
    const next = fieldsRef.current.filter((_, i) => !selectedSet.has(i));
    setFields(next);
    fieldsRef.current = next;
    selectOnly(null);
    persistFields();
  }

  // ── Drag de campos (pointer events) ────────────────────────────────────────

  function onFieldPointerDown(e: React.PointerEvent, index: number) {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    (e.currentTarget as HTMLElement).focus();
    let active: Set<number>;
    if (e.shiftKey) {
      toggleInSelection(index);
      active = new Set(selectedSet);
      if (active.has(index)) active.delete(index);
      else active.add(index);
    } else if (selectedSet.has(index)) {
      setSelectedIndex(index);
      active = new Set(selectedSet);
    } else {
      selectOnly(index);
      active = new Set([index]);
    }
    const orig = new Map<number, { x: number; y: number }>();
    for (const i of active) {
      const f = fieldsRef.current[i];
      if (f) orig.set(i, { x: f.x, y: f.y });
    }
    dragRef.current = {
      pointerId: e.pointerId,
      index,
      startClientX: e.clientX,
      startClientY: e.clientY,
      orig,
      moved: false,
    };
  }

  function onFieldPointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.moved) {
      // Umbral de 3px: un clic sin movimiento no crea historial
      if (
        Math.abs(e.clientX - drag.startClientX) < 3 &&
        Math.abs(e.clientY - drag.startClientY) < 3
      ) {
        return;
      }
      drag.moved = true;
      pushHistory();
    }
    let dx = (e.clientX - drag.startClientX) / scale;
    let dy = (e.clientY - drag.startClientY) / scale;

    const primaryOrig = drag.orig.get(drag.index);
    const primary = fieldsRef.current[drag.index];
    if (!primaryOrig || !primary) return;
    const movingRect = rectOf({
      ...primary,
      x: primaryOrig.x + dx,
      y: primaryOrig.y + dy,
    });
    const others = fieldsRef.current
      .map((f, i) => ({ f, i }))
      .filter(({ f, i }) => !drag.orig.has(i) && f.enabled !== false)
      .map(({ f }) => rectOf(f));

    // Alt desactiva el ajuste momentáneamente (como en Canva/Figma)
    if (snapOn && !e.altKey) {
      const snap = computeSnap({
        moving: movingRect,
        others,
        pageW,
        pageH,
        margin: PAGE_MARGIN_PT,
        tolerance: SNAP_TOLERANCE_PT,
      });
      dx += snap.dx;
      dy += snap.dy;
      setGuides(snap.guides);
    } else {
      setGuides([]);
    }
    const finalRect = rectOf({
      ...primary,
      x: primaryOrig.x + dx,
      y: primaryOrig.y + dy,
    });
    setLiveMeasures(computeMeasures(finalRect, others, pageW, pageH));

    const next = fieldsRef.current.map((f, i) => {
      const o = drag.orig.get(i);
      if (!o) return f;
      return {
        ...f,
        x: clamp(Math.round(o.x + dx), 0, pageW),
        y: clamp(Math.round(o.y + dy), 0, pageH),
      };
    });
    setFields(next);
    fieldsRef.current = next;
    setSaveState("idle");
  }

  function onFieldPointerUp(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    dragRef.current = null;
    setGuides([]);
    setLiveMeasures([]);
    if (drag.moved) persistFields();
  }

  function onFieldKeyDown(e: React.KeyboardEvent, index: number) {
    const k = e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey) {
      if (k === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (k === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (k === "d") {
        e.preventDefault();
        duplicateSelection();
        return;
      }
      if (k === "a") {
        e.preventDefault();
        setMulti(new Set(fields.map((_, i) => i)));
        return;
      }
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      removeSelection();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      selectOnly(null);
      return;
    }
    const step = e.shiftKey ? 10 : 1;
    const targets = selectedSet.has(index) ? Array.from(selectedSet) : [index];
    let dx = 0;
    let dy = 0;
    if (e.key === "ArrowLeft") dx = -step;
    else if (e.key === "ArrowRight") dx = step;
    else if (e.key === "ArrowUp") dy = -step;
    else if (e.key === "ArrowDown") dy = step;
    else return;
    e.preventDefault();
    applyDeltas(new Map(targets.map((i) => [i, { dx, dy }])));
  }

  // ── Agregar / quitar / mostrar-ocultar campos ──────────────────────────────

  function addField(key: EditorFieldKey) {
    pushHistory();
    let field = defaultsFor(key, pageW, pageH);
    if (key === "validity") {
      // «Vigente hasta…» va justo debajo de la fecha, con su misma alineación
      const date = fields.find((f) => f.key === "date");
      if (date) {
        field = {
          ...field,
          x: date.x,
          y: clamp(date.y + date.fontSize + 8, 0, pageH),
          align: date.align,
        };
      }
    }
    const next = [...fields, field];
    setFields(next);
    fieldsRef.current = next;
    selectOnly(next.length - 1);
    setSaveState("idle");
  }

  function toggleFieldEnabled(index: number) {
    pushHistory();
    const next = fieldsRef.current.map((f, i) =>
      i === index ? { ...f, enabled: f.enabled === false ? true : false } : f,
    );
    setFields(next);
    fieldsRef.current = next; // persistFields lee el ref antes del re-render
    persistFields();
  }

  const busy = saving || generating || uploadingBg;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <header className="anim-rise relative overflow-hidden rounded-2xl border bg-card p-5 shadow-[0_1px_2px_rgb(15_23_42/0.05)] md:p-6">
        <span
          aria-hidden
          className="section-gradient absolute inset-x-0 top-0 h-1"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-section opacity-[0.12]"
        />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <span className="section-gradient section-glow flex size-12 shrink-0 items-center justify-center rounded-xl text-section-fg">
              <FileBadge className="size-6" aria-hidden />
            </span>
            <div className="min-w-0">
              <Link
                href="/teach/templates"
                className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.14em] text-section-strong hover:underline"
              >
                <ArrowLeft className="size-3.5" aria-hidden />
                Plantillas
              </Link>
              <h1 className="truncate font-heading text-2xl font-bold tracking-tight md:text-[1.75rem]">
                {name || "Sin nombre"}
              </h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground" role="status">
              {saveState === "saving" ? (
                <span className="flex items-center gap-1">
                  <Loader2 className="size-3 animate-spin" aria-hidden />
                  Guardando…
                </span>
              ) : saveState === "saved" ? (
                <span className="flex items-center gap-1 text-success">
                  <Check className="size-3" aria-hidden />
                  Guardado
                </span>
              ) : null}
            </span>
            <Button
              variant="outline"
              className="h-11"
              onClick={generateTestPdf}
              disabled={busy}
            >
              {generating ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <FileDown aria-hidden />
              )}
              {generating ? "Generando…" : "Generar PDF de prueba"}
            </Button>
            <Button
              onClick={saveAll}
              disabled={busy || !name.trim()}
              className="h-11 bg-cta px-6 text-cta-foreground hover:bg-cta/90"
            >
              Guardar
            </Button>
          </div>
        </div>
      </header>

      {/* Aviso permanente */}
      <div className="flex items-start gap-2 rounded-xl border border-section/30 bg-section-soft/60 p-3 text-sm">
        <Info
          className="mt-0.5 size-4 shrink-0 text-section-strong"
          aria-hidden
        />
        <p>Los cambios no afectan certificados ya emitidos.</p>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        {/* Panel izquierdo */}
        <aside className="anim-rise space-y-5 rounded-xl border bg-card p-4 shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-section-strong">
            Plantilla
          </p>
          <div className="grid gap-2">
            <Label htmlFor="template-name">Nombre</Label>
            <Input
              id="template-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setSaveState("idle");
              }}
              maxLength={120}
            />
          </div>

          {/* Fondo */}
          <div className="grid gap-2">
            <Label>Fondo (PDF, PNG o JPG)</Label>
            <input
              ref={bgInputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg"
              className="sr-only"
              aria-label="Elegir archivo de fondo"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleBgFile(file);
              }}
            />
            {uploadingBg ? (
              <div className="flex items-center gap-2 rounded-lg border p-2.5 text-sm text-muted-foreground">
                <Loader2
                  className="size-4 animate-spin text-section-strong"
                  aria-hidden
                />
                Subiendo…
              </div>
            ) : background ? (
              <div className="flex items-center gap-2 rounded-lg border p-2.5 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  {background.name}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => bgInputRef.current?.click()}
                >
                  Cambiar
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => bgInputRef.current?.click()}
                className="flex items-center justify-center gap-2 rounded-lg border-2 border-dashed p-3 text-sm text-muted-foreground transition-colors hover:border-section hover:text-section-strong"
              >
                <Upload className="size-4" aria-hidden />
                Subir fondo
              </button>
            )}
          </div>

          {/* Tamaño y orientación */}
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">Tamaño</legend>
            <RadioGroup
              value={pageSize}
              onValueChange={(v) => {
                setPageSize(v as typeof pageSize);
                setSaveState("idle");
              }}
              className="flex gap-4"
            >
              <label className="flex items-center gap-1.5 text-sm">
                <RadioGroupItem value="letter" /> Carta
              </label>
              <label className="flex items-center gap-1.5 text-sm">
                <RadioGroupItem value="a4" /> A4
              </label>
            </RadioGroup>
          </fieldset>

          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">Orientación</legend>
            <RadioGroup
              value={orientation}
              onValueChange={(v) => {
                setOrientation(v as typeof orientation);
                setSaveState("idle");
              }}
              className="flex gap-4"
            >
              <label className="flex items-center gap-1.5 text-sm">
                <RadioGroupItem value="landscape" /> Horizontal
              </label>
              <label className="flex items-center gap-1.5 text-sm">
                <RadioGroupItem value="portrait" /> Vertical
              </label>
            </RadioGroup>
          </fieldset>

          <Separator />

          {/* Adornos */}
          <div className="grid gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-section-strong">
              Adornos
            </p>
            <div className="grid grid-cols-2 gap-2">
              {[null, ...DECOR_PRESETS].map((preset) => {
                const id = preset?.id ?? null;
                const active = decor === id;
                return (
                  <button
                    key={id ?? "none"}
                    type="button"
                    onClick={() => selectDecor(id)}
                    aria-pressed={active}
                    aria-label={
                      preset ? `Adornos: ${preset.name}` : "Sin adornos"
                    }
                    title={
                      preset?.description ??
                      "El certificado sale sin adornos dibujados"
                    }
                    className={cn(
                      "rounded-lg border-2 p-1.5 text-left transition-colors duration-200",
                      active
                        ? "border-section bg-section-soft/50"
                        : "border-border hover:border-section/50",
                    )}
                  >
                    <span
                      className="relative block w-full overflow-hidden rounded-[3px] border border-border/60 bg-white"
                      style={{ aspectRatio: `${pageW} / ${pageH}` }}
                    >
                      {preset ? (
                        <DecorOverlay
                          preset={preset}
                          pageW={pageW}
                          pageH={pageH}
                          thumbnail
                        />
                      ) : (
                        <span className="absolute inset-0 flex items-center justify-center">
                          <Ban
                            className="size-4 text-muted-foreground/40"
                            aria-hidden
                          />
                        </span>
                      )}
                    </span>
                    <span
                      className={cn(
                        "mt-1 block truncate text-xs transition-colors duration-150",
                        active
                          ? "font-medium text-section-strong"
                          : "text-muted-foreground",
                      )}
                    >
                      {preset?.name ?? "Sin adornos"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <Separator />

          {/* Lista de campos. minmax(0,1fr): sin él, un texto largo (nowrap +
              truncate) ensancha la columna y la lista se sale del panel */}
          <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-section-strong">
                Campos
              </p>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline">
                    <Plus aria-hidden />
                    Agregar campo
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  {ADDABLE_KEYS.map((key) => {
                    const exists =
                      key !== "custom_text" &&
                      fields.some((f) => f.key === key);
                    const Icon = FIELD_ICONS[key];
                    return (
                      <DropdownMenuItem
                        key={key}
                        disabled={exists}
                        onSelect={() => addField(key)}
                      >
                        <Icon
                          className="size-4 text-muted-foreground"
                          aria-hidden
                        />
                        {FIELD_LABELS[key]}
                        {exists && (
                          <span className="ml-auto text-xs text-muted-foreground">
                            ya existe
                          </span>
                        )}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {fields.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Sin campos: el certificado saldría vacío.
              </p>
            ) : (
              <ul className="space-y-0.5">
                {fields.map((field, i) => {
                  const disabled = field.enabled === false;
                  return (
                    <li key={i}>
                      <div
                        className={cn(
                          "relative flex w-full items-center gap-1 rounded-lg pr-1 transition-colors duration-150 hover:bg-section-soft/50",
                          selectedSet.has(i) &&
                            "bg-section-soft before:absolute before:inset-y-1.5 before:left-0 before:w-1 before:rounded-full before:bg-section",
                        )}
                      >
                        <button
                          type="button"
                          onClick={(e) =>
                            e.shiftKey ? toggleInSelection(i) : selectOnly(i)
                          }
                          className="min-w-0 flex-1 px-2 py-1.5 text-left text-sm"
                        >
                          <span
                            className={cn(
                              "block truncate",
                              disabled && "text-muted-foreground",
                            )}
                          >
                            {FIELD_LABELS[field.key]}
                          </span>
                          {field.key === "custom_text" && field.text && (
                            <span
                              className={cn(
                                "block truncate text-[11px] text-muted-foreground",
                                disabled && "opacity-70",
                              )}
                            >
                              «{field.text}»
                            </span>
                          )}
                          {disabled && (
                            <span className="block text-[11px] italic text-muted-foreground">
                              No se imprime
                            </span>
                          )}
                        </button>
                        {isOverflowing(field, sampleName, mounted) && (
                          <TriangleAlert
                            className="size-3.5 shrink-0 text-warning"
                            aria-label={OVERFLOW_HINT}
                          />
                        )}
                        <button
                          type="button"
                          onClick={() => toggleFieldEnabled(i)}
                          aria-label={TOGGLE_LABEL}
                          aria-pressed={!disabled}
                          title={
                            disabled
                              ? "Oculto: no se imprime"
                              : "Visible: se imprime"
                          }
                          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-200 hover:bg-section-soft hover:text-foreground"
                        >
                          {disabled ? (
                            <EyeOff className="size-4" aria-hidden />
                          ) : (
                            <Eye className="size-4" aria-hidden />
                          )}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Propiedades del campo seleccionado */}
          {selected && selectedIndex !== null && (
            <>
              <Separator />
              <div className="grid gap-3">
                <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-section-strong">
                  {FIELD_LABELS[selected.key]}
                  {(selected.key === "validity" || selected.key === "qr") && (
                    <HelpTip topic="templates.fields" value={{ field: selected.key }} />
                  )}
                </p>

                {selected.key === "validity" && (
                  <p className="flex items-start gap-1.5 rounded-lg bg-muted/60 p-2 text-xs text-muted-foreground">
                    <Info className="mt-px size-3.5 shrink-0" aria-hidden />
                    <span>
                      Se omite en certificados vitalicios. La fecha sale de la vigencia
                      configurada en cada curso.
                    </span>
                  </p>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <div className="grid gap-1">
                    <Label htmlFor="field-x" className="text-xs">
                      X (pts){" "}
                      <span className="text-muted-foreground">
                        · {ptToMm(selected.x)}
                      </span>
                    </Label>
                    <Input
                      id="field-x"
                      type="number"
                      value={selected.x}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (Number.isFinite(n))
                          updateField(selectedIndex, { x: Math.round(n) });
                      }}
                      className="h-8"
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="field-y" className="text-xs">
                      Y (pts){" "}
                      <span className="text-muted-foreground">
                        · {ptToMm(selected.y)}
                      </span>
                    </Label>
                    <Input
                      id="field-y"
                      type="number"
                      value={selected.y}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (Number.isFinite(n))
                          updateField(selectedIndex, { y: Math.round(n) });
                      }}
                      className="h-8"
                    />
                  </div>
                </div>

                <div className="grid gap-1">
                  <Label htmlFor="field-size" className="text-xs">
                    {selected.key === "qr"
                      ? "Lado del QR (pts)"
                      : "Tamaño de fuente"}
                  </Label>
                  <Input
                    id="field-size"
                    type="number"
                    min={4}
                    max={400}
                    value={selected.fontSize}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n)) {
                        updateField(selectedIndex, {
                          fontSize: Math.round(clamp(n, 4, 400)),
                        });
                      }
                    }}
                    className="h-8 w-24"
                  />
                </div>

                {selected.key !== "qr" && (
                  <>
                    <div className="grid gap-1">
                      <Label className="text-xs">Fuente</Label>
                      <Select
                        value={selected.font}
                        onValueChange={(v) =>
                          updateField(selectedIndex, {
                            font: v as EditorField["font"],
                          })
                        }
                      >
                        <SelectTrigger
                          className="h-8 w-full"
                          aria-label="Fuente"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(
                            Object.keys(FONT_LABELS) as EditorField["font"][]
                          ).map((font) => (
                            <SelectItem key={font} value={font}>
                              {FONT_LABELS[font]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="grid gap-1">
                        <Label htmlFor="field-color" className="text-xs">
                          Color
                        </Label>
                        <input
                          id="field-color"
                          type="color"
                          value={selected.color}
                          onChange={(e) =>
                            updateField(selectedIndex, {
                              color: e.target.value,
                            })
                          }
                          className="h-8 w-full cursor-pointer rounded-lg border bg-transparent p-0.5"
                        />
                      </div>
                      <div className="grid gap-1">
                        <Label className="text-xs">Alineación</Label>
                        <Select
                          value={selected.align}
                          onValueChange={(v) =>
                            updateField(selectedIndex, {
                              align: v as EditorField["align"],
                            })
                          }
                        >
                          <SelectTrigger
                            className="h-8 w-full"
                            aria-label="Alineación"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="left">Izquierda</SelectItem>
                            <SelectItem value="center">Centro</SelectItem>
                            <SelectItem value="right">Derecha</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {selected.key === "custom_text" && (
                      <div className="grid gap-1">
                        <Label htmlFor="field-text" className="text-xs">
                          Texto
                        </Label>
                        <Input
                          id="field-text"
                          value={selected.text ?? ""}
                          onChange={(e) =>
                            updateField(selectedIndex, { text: e.target.value })
                          }
                          maxLength={500}
                          className="h-8"
                        />
                      </div>
                    )}

                    <div className="grid gap-1">
                      <Label htmlFor="field-max-width" className="text-xs">
                        Ancho máximo (pts)
                      </Label>
                      <Input
                        id="field-max-width"
                        type="number"
                        min={20}
                        max={2000}
                        value={selected.maxWidth ?? ""}
                        placeholder="Sin límite"
                        onChange={(e) => {
                          const raw = e.target.value;
                          if (raw === "") {
                            updateField(selectedIndex, { maxWidth: undefined });
                            return;
                          }
                          const n = Number(raw);
                          if (Number.isFinite(n)) {
                            updateField(selectedIndex, {
                              maxWidth: Math.round(n),
                            });
                          }
                        }}
                        className="h-8 w-28"
                      />
                      <p className="text-xs text-muted-foreground">
                        Si el texto no cabe, el PDF reduce la fuente hasta que
                        quepa.
                      </p>
                    </div>
                  </>
                )}

                <Button
                  variant="destructive"
                  size="sm"
                  onClick={removeSelection}
                  className="justify-self-start"
                >
                  <Trash2 aria-hidden />
                  Quitar campo
                </Button>
              </div>
            </>
          )}
        </aside>

        {/* Lienzo: proporción EXACTA de la página, sin bordes ni padding que
            resten área útil (el ring y la sombra quedan por fuera del box). */}
        <section className="anim-rise anim-d1 space-y-3">
          <AlignToolbar
            selectedCount={selectedSet.size}
            canUndo={history.past.length > 0}
            canRedo={history.future.length > 0}
            snapOn={snapOn}
            showGrid={showGrid}
            showRulers={showRulers}
            onAlign={alignSelection}
            onDistribute={distributeSelection}
            onDuplicate={duplicateSelection}
            onRemove={removeSelection}
            onUndo={undo}
            onRedo={redo}
            onToggleSnap={() => setSnapOn((v) => !v)}
            onToggleGrid={() => setShowGrid((v) => !v)}
            onToggleRulers={() => setShowRulers((v) => !v)}
          />
          <div className="overflow-x-auto rounded-xl border bg-card p-5 shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
            <div
              className="mx-auto"
              style={{ width: CANVAS_W + (showRulers ? RULER_PX : 0) }}
            >
              <CanvasRulers
                scale={scale}
                pageW={pageW}
                pageH={pageH}
                size={showRulers ? RULER_PX : 0}
              >
                <div
                  className="relative overflow-hidden bg-white ring-4 ring-section-soft shadow-[0_6px_24px_-8px_rgb(15_23_42/0.28)]"
                  style={{ width: CANVAS_W, height: pageH * scale }}
                  onPointerDown={(e) => {
                    if (e.target === e.currentTarget) selectOnly(null);
                  }}
                >
                  {background && !background.isPdf ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/files/${background.fileId}`}
                      alt=""
                      draggable={false}
                      className="pointer-events-none absolute inset-0 h-full w-full select-none object-fill"
                    />
                  ) : background && background.isPdf ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-slate-100">
                      <p className="max-w-64 text-center text-xs text-slate-500">
                        Fondo PDF ({background.name}) — usa «Generar PDF de
                        prueba» para verlo
                      </p>
                    </div>
                  ) : !activePreset ? (
                    <div
                      className="pointer-events-none absolute rounded-sm border-2 border-primary/40"
                      style={{ inset: Math.round(24 * scale) }}
                      aria-hidden
                    />
                  ) : null}

                  {/* Adornos del preset: sobre el fondo, debajo de los campos */}
                  <DecorOverlay
                    preset={activePreset}
                    pageW={pageW}
                    pageH={pageH}
                  />

                  {showGrid && (
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-0"
                      style={{
                        backgroundImage:
                          "linear-gradient(to right, rgb(99 102 241 / 0.12) 1px, transparent 1px), linear-gradient(to bottom, rgb(99 102 241 / 0.12) 1px, transparent 1px)",
                        backgroundSize: `${GRID_PT * scale}px ${GRID_PT * scale}px`,
                      }}
                    />
                  )}
                  <CanvasGuides
                    guides={guides}
                    measures={liveMeasures}
                    scale={scale}
                    pageW={pageW}
                    pageH={pageH}
                  />

                  {fields.map((field, i) => {
                    const isSelected = selectedSet.has(i);
                    const disabled = field.enabled === false;
                    const overflow = isOverflowing(field, sampleName, mounted);
                    const outlineClass = cn(
                      "absolute cursor-move touch-none select-none outline-1 outline-dashed outline-slate-400/70 transition-opacity duration-200",
                      isSelected &&
                        "z-10 outline-2 outline-solid outline-primary",
                      overflow && "outline-warning",
                      // Fantasma: sigue editable pero el server no lo imprime
                      disabled && "outline-dashed opacity-40",
                    );

                    if (field.key === "qr") {
                      // Mismo mínimo que el server (Math.max(40, fontSize))
                      const side = Math.max(40, field.fontSize) * scale;
                      return (
                        <div
                          key={i}
                          role="button"
                          tabIndex={0}
                          aria-label={`Campo ${FIELD_LABELS[field.key]}`}
                          onPointerDown={(e) => onFieldPointerDown(e, i)}
                          onPointerMove={onFieldPointerMove}
                          onPointerUp={onFieldPointerUp}
                          onPointerCancel={onFieldPointerUp}
                          onKeyDown={(e) => onFieldKeyDown(e, i)}
                          className={cn(
                            outlineClass,
                            "flex items-center justify-center bg-slate-300/70 text-xs font-medium text-slate-600",
                          )}
                          style={{
                            left: field.x * scale,
                            top: field.y * scale,
                            width: side,
                            height: side,
                          }}
                        >
                          QR
                          {isSelected && <SelectionHandles />}
                        </div>
                      );
                    }

                    const css = FONT_CSS[field.font];
                    const text = displayText(field, sampleName);
                    // Misma reducción automática que el server (mínimo 8 pts)
                    const size = effectiveFontSize(field, text, mounted);
                    return (
                      <div
                        key={i}
                        role="button"
                        tabIndex={0}
                        aria-label={`Campo ${FIELD_LABELS[field.key]}`}
                        title={overflow ? OVERFLOW_HINT : undefined}
                        onPointerDown={(e) => onFieldPointerDown(e, i)}
                        onPointerMove={onFieldPointerMove}
                        onPointerUp={onFieldPointerUp}
                        onPointerCancel={onFieldPointerUp}
                        onKeyDown={(e) => onFieldKeyDown(e, i)}
                        className={cn(
                          outlineClass,
                          "whitespace-nowrap leading-none",
                        )}
                        style={{
                          left: field.x * scale,
                          top: field.y * scale,
                          fontSize: size * scale,
                          fontFamily: css.family,
                          fontWeight: css.weight,
                          color: field.color,
                          transform:
                            field.align === "center"
                              ? "translateX(-50%)"
                              : field.align === "right"
                                ? "translateX(-100%)"
                                : undefined,
                        }}
                      >
                        {/* Sube la diferencia de baseline CSS vs. PDF (ver PDF_ASCENT_EM) */}
                        <span
                          className="block"
                          style={{
                            transform: `translateY(${-fontShifts[field.font]}em)`,
                          }}
                        >
                          {text}
                        </span>
                        {isSelected && <SelectionHandles />}
                      </div>
                    );
                  })}
                </div>
              </CanvasRulers>
            </div>
          </div>

          {/* Probar con */}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Probar con:</span>
            <Select
              value={sample}
              onValueChange={(v) => setSample(v as SampleKey)}
            >
              <SelectTrigger className="max-w-80" aria-label="Nombre de prueba">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="short">{SAMPLE_NAMES.short}</SelectItem>
                <SelectItem value="medium">{SAMPLE_NAMES.medium}</SelectItem>
                <SelectItem value="long">{SAMPLE_NAMES.long}</SelectItem>
              </SelectContent>
            </Select>
            {anyOverflow && (
              <span className="flex items-center gap-1 text-warning">
                <TriangleAlert className="size-4 shrink-0" aria-hidden />
                {OVERFLOW_HINT}.
              </span>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
