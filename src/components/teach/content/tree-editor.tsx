"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AlignLeft,
  Check,
  ChevronRight,
  ClipboardPaste,
  Clock,
  Copy,
  CopyPlus,
  EllipsisVertical,
  FileQuestion,
  FileText,
  Folder,
  FolderPlus,
  GripVertical,
  Keyboard,
  Loader2,
  Play,
  Plus,
  Scissors,
  Trash2,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { KindChip, kindMeta } from "@/components/kind-meta";
import { HelpTip } from "@/components/help/help-tip";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  createItemAction,
  deleteItemAction,
  duplicateItemAction,
  moveItemAction,
} from "@/server/actions/teacher-tree";
import { OpenFromUrl } from "@/components/open-from-url";
import { clearUrlParam, useOpenDialogRequest } from "@/lib/open-dialog";

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type TreeItemKind = "folder" | "document" | "video" | "text" | "exam" | "assignment" | "resource" | "link";

export type TreeItem = {
  id: string;
  parentId: string | null;
  kind: TreeItemKind;
  title: string;
  children: TreeItem[];
};

export type DocStatus = {
  status: "pending" | "processing" | "ready" | "error";
  pageCount: number | null;
  hasFile: boolean;
};

type Row = {
  item: TreeItem;
  depth: number;
  parentId: string | null;
  /** Índice dentro de la lista completa de hermanos (incluyéndose). */
  siblingIndex: number;
  siblingCount: number;
};

type DropIndicator = {
  overId: string;
  type: "before" | "after" | "inside";
  invalid: boolean;
};

/** Lo copiado o cortado. Lo copiado se guarda en el navegador: se puede pegar en otro curso. */
type Clip = {
  mode: "copy" | "cut";
  courseId: string;
  itemId: string;
  title: string;
  kind: TreeItemKind;
};

/** Lo que Ctrl+Z puede deshacer. */
type UndoEntry =
  | { type: "move"; itemId: string; title: string; from: { parentId: string | null; index: number } }
  | { type: "create"; itemId: string; title: string }
  | { type: "delete"; itemId: string; title: string };

type PendingDelete = {
  item: TreeItem;
  parentId: string | null;
  index: number;
  timer: number;
};

const NEW_TITLES: Partial<Record<TreeItemKind, string>> = {
  folder: "Nueva carpeta",
  document: "Nuevo documento",
  text: "Nueva lectura",
  video: "Nuevo video",
  exam: "Nuevo examen",
  assignment: "Nueva tarea",
  resource: "Nuevo recurso descargable",
  link: "Nuevo enlace externo",
};

const MAX_FOLDER_DEPTH = 2;
/** Tiempo para deshacer un borrado antes de que se haga de verdad en el servidor. */
const UNDO_DELETE_MS = 8000;
const CLIP_KEY = "plataforma:contenido-copiado";

const SHORTCUTS: [string, string][] = [
  ["↑ ↓", "Moverse por la lista"],
  ["→ ←", "Abrir / cerrar carpeta"],
  ["Alt + ↑ ↓", "Subir o bajar el elemento"],
  ["Ctrl + C", "Copiar"],
  ["Ctrl + X", "Cortar (para moverlo)"],
  ["Ctrl + V", "Pegar dentro de la carpeta o debajo"],
  ["Ctrl + D", "Duplicar"],
  ["Supr", "Eliminar"],
  ["Ctrl + Z", "Deshacer"],
  ["F2", "Cambiar el título"],
  ["Esc", "Cancelar el corte"],
];

// ─── Utilidades de árbol (inmutables) ────────────────────────────────────────

function flatten(
  nodes: TreeItem[],
  collapsed: Set<string>,
  hiddenSubtree: string | null,
  depth = 0,
  parentId: string | null = null
): Row[] {
  const rows: Row[] = [];
  nodes.forEach((item, i) => {
    rows.push({ item, depth, parentId, siblingIndex: i, siblingCount: nodes.length });
    const hideChildren =
      collapsed.has(item.id) || item.id === hiddenSubtree || item.children.length === 0;
    if (!hideChildren) {
      rows.push(...flatten(item.children, collapsed, hiddenSubtree, depth + 1, item.id));
    }
  });
  return rows;
}

function findNode(nodes: TreeItem[], id: string): TreeItem | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const hit = findNode(node.children, id);
    if (hit) return hit;
  }
  return null;
}

/** Padre e índice de un ítem dentro de sus hermanos. */
function locate(nodes: TreeItem[], id: string, parentId: string | null = null): { parentId: string | null; index: number } | null {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].id === id) return { parentId, index: i };
    const hit = locate(nodes[i].children, id, nodes[i].id);
    if (hit) return hit;
  }
  return null;
}

function removeNode(nodes: TreeItem[], id: string): { tree: TreeItem[]; removed: TreeItem | null } {
  let removed: TreeItem | null = null;
  const walk = (list: TreeItem[]): TreeItem[] =>
    list
      .filter((n) => {
        if (n.id === id) {
          removed = n;
          return false;
        }
        return true;
      })
      .map((n) => ({ ...n, children: walk(n.children) }));
  return { tree: walk(nodes), removed };
}

function insertNode(
  nodes: TreeItem[],
  parentId: string | null,
  index: number,
  node: TreeItem
): TreeItem[] {
  if (parentId === null) {
    const copy = [...nodes];
    copy.splice(Math.max(0, Math.min(index, copy.length)), 0, { ...node, parentId: null });
    return copy;
  }
  return nodes.map((n) => {
    if (n.id === parentId) {
      const children = [...n.children];
      children.splice(Math.max(0, Math.min(index, children.length)), 0, {
        ...node,
        parentId,
      });
      return { ...n, children };
    }
    return { ...n, children: insertNode(n.children, parentId, index, node) };
  });
}

/** Profundidad de carpetas del padre destino (0 = raíz, 1 = dentro de carpeta raíz…). */
function folderDepthOf(nodes: TreeItem[], parentId: string | null): number {
  let depth = 0;
  let current = parentId;
  while (current) {
    const parent = findNode(nodes, current);
    if (!parent) break;
    depth += 1;
    current = parent.parentId;
  }
  return depth;
}

function hasSubfolders(item: TreeItem): boolean {
  return item.children.some((c) => c.kind === "folder");
}

function isDescendant(ancestor: TreeItem, id: string): boolean {
  return ancestor.children.some((c) => c.id === id || isDescendant(c, id));
}

/** ¿Cabe `item` (con sus subcarpetas) dentro de `parentId` sin pasar de dos niveles? */
function fitsDepth(nodes: TreeItem[], item: Pick<TreeItem, "kind" | "children">, parentId: string | null): boolean {
  if (item.kind !== "folder") return true;
  return folderDepthOf(nodes, parentId) + 1 + (hasSubfolders(item as TreeItem) ? 1 : 0) <= MAX_FOLDER_DEPTH;
}

function readClip(): Clip | null {
  try {
    const raw = window.localStorage.getItem(CLIP_KEY);
    return raw ? (JSON.parse(raw) as Clip) : null;
  } catch {
    return null;
  }
}

function writeClip(clip: Clip | null) {
  try {
    if (clip?.mode === "copy") window.localStorage.setItem(CLIP_KEY, JSON.stringify(clip));
    else window.localStorage.removeItem(CLIP_KEY);
  } catch {
    /* sin almacenamiento del navegador: lo copiado vive solo en esta página */
  }
}

// ─── Componente principal ────────────────────────────────────────────────────

export function TreeEditor({
  courseId,
  tree: serverTree,
  docStatus,
  selectedId,
}: {
  courseId: string;
  tree: TreeItem[];
  docStatus: Record<string, DocStatus>;
  selectedId: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [tree, setTree] = useState(serverTree);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropIndicator | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TreeItem | null>(null);
  // La guía de primeros pasos llega con ?agregar=1 y despliega el menú «Agregar»
  const [addOpen, setAddOpen] = useState(false);
  const [clip, setClip] = useState<Clip | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [, startTransition] = useTransition();
  const undoStack = useRef<UndoEntry[]>([]);
  const pending = useRef(new Map<string, PendingDelete>());
  const panelRef = useRef<HTMLDivElement>(null);
  /** Fila a enfocar cuando aparezca (tras crear, pegar o moverse con el teclado) */
  const focusWhenReady = useRef<string | null>(null);

  // Sincronizar con el servidor cuando llegan datos nuevos (patrón React de
  // "derived state"): el estado local solo existe para los cambios optimistas.
  // Lo que está por borrarse (aún se puede deshacer) no se vuelve a mostrar.
  const serverTreeRef = useRef(serverTree);
  if (serverTreeRef.current !== serverTree) {
    serverTreeRef.current = serverTree;
    let next = serverTree;
    for (const id of pending.current.keys()) next = removeNode(next, id).tree;
    setTree(next);
  }

  // Lo copiado en otra pestaña o curso (se lee al montar: en el servidor no hay navegador)
  useEffect(() => {
    setClip((c) => c ?? readClip());
  }, []);

  // Al salir de la página, los borrados pendientes se hacen ya
  useEffect(() => {
    const pendingNow = pending.current;
    const flush = () => {
      for (const [id, p] of pendingNow) {
        window.clearTimeout(p.timer);
        toast.dismiss(`borrar-${id}`);
        void deleteItemAction(courseId, id);
      }
      pendingNow.clear();
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [courseId]);

  // Ctrl+Z también cuando el foco no está en ningún lado (p. ej. tras cerrar un
  // aviso): la página no tiene otra cosa que deshacer
  const undoRef = useRef<() => void>(() => {});
  useEffect(() => {
    undoRef.current = undo;
  });
  useEffect(() => {
    const onWindowKey = (e: KeyboardEvent) => {
      if (document.activeElement !== document.body) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undoRef.current();
      }
    };
    window.addEventListener("keydown", onWindowKey);
    return () => window.removeEventListener("keydown", onWindowKey);
  }, []);

  const rows = useMemo(
    () => flatten(tree, collapsed, activeId),
    [tree, collapsed, activeId]
  );
  const activeItem = activeId ? findNode(tree, activeId) : null;
  const selected = selectedId ? findNode(tree, selectedId) : null;

  useEffect(() => {
    const id = focusWhenReady.current;
    if (!id) return;
    const el = panelRef.current?.querySelector<HTMLElement>(`[data-row-select="${id}"]`);
    if (el) {
      el.focus();
      focusWhenReady.current = null;
    }
  }, [rows]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function select(id: string, focus = false) {
    if (focus) focusWhenReady.current = id;
    router.push(`${pathname}?item=${id}`, { scroll: false });
  }

  function expand(id: string) {
    setCollapsed((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  // ── Cálculo del destino del drag ──────────────────────────────────────────

  function computeDrop(event: DragMoveEvent): DropIndicator | null {
    const { active, over } = event;
    if (!over || over.id === active.id) return null;
    const overRow = rows.find((r) => r.item.id === over.id);
    const dragged = findNode(tree, String(active.id));
    if (!overRow || !dragged) return null;

    const translated = active.rect.current.translated;
    const centerY = translated ? translated.top + translated.height / 2 : over.rect.top;
    const rel = (centerY - over.rect.top) / over.rect.height;

    let type: DropIndicator["type"];
    if (overRow.item.kind === "folder" && rel >= 0.3 && rel <= 0.7) {
      type = "inside";
    } else {
      type = rel < 0.5 ? "before" : "after";
    }

    const targetParentId = type === "inside" ? overRow.item.id : overRow.parentId;

    // Nunca dentro de sí mismo ni de un descendiente; máximo dos niveles de carpetas
    const invalid =
      targetParentId === dragged.id ||
      (targetParentId !== null && isDescendant(dragged, targetParentId)) ||
      !fitsDepth(tree, dragged, targetParentId);

    return { overId: overRow.item.id, type, invalid };
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragMove(event: DragMoveEvent) {
    setDrop(computeDrop(event));
  }

  function handleDragEnd(event: DragEndEvent) {
    const dragged = activeId ? findNode(tree, activeId) : null;
    const finalDrop = drop;
    setActiveId(null);
    setDrop(null);
    if (!dragged || !finalDrop || !event.over) return;

    if (finalDrop.invalid) {
      toast.error("Máximo dos niveles de carpetas");
      return;
    }

    const overRow = rows.find((r) => r.item.id === finalDrop.overId);
    if (!overRow) return;

    let newParentId: string | null;
    let newIndex: number;

    if (finalDrop.type === "inside") {
      newParentId = overRow.item.id;
      const folder = findNode(tree, newParentId);
      newIndex = folder ? folder.children.filter((c) => c.id !== dragged.id).length : 0;
      expand(overRow.item.id);
    } else {
      newParentId = overRow.parentId;
      const siblings = (
        newParentId === null ? tree : findNode(tree, newParentId)?.children ?? []
      ).filter((c) => c.id !== dragged.id);
      const overIdx = siblings.findIndex((c) => c.id === overRow.item.id);
      newIndex = overIdx < 0 ? siblings.length : overIdx + (finalDrop.type === "after" ? 1 : 0);
    }

    applyMove(dragged, newParentId, newIndex);
  }

  /**
   * Reorden optimista con rollback si el servidor rechaza el movimiento.
   * `record`: se anota para Ctrl+Z (deshacer un movimiento no se vuelve a anotar).
   */
  function applyMove(dragged: TreeItem, newParentId: string | null, newIndex: number, record = true) {
    const previous = tree;
    const from = locate(tree, dragged.id);
    const { tree: without, removed } = removeNode(tree, dragged.id);
    if (!removed || !from) return;
    if (from.parentId === newParentId && from.index === newIndex) return;
    setTree(insertNode(without, newParentId, newIndex, removed));
    if (record) undoStack.current.push({ type: "move", itemId: dragged.id, title: dragged.title, from });

    startTransition(async () => {
      const result = await moveItemAction({
        courseId,
        itemId: dragged.id,
        newParentId,
        newIndex,
      });
      if ("error" in result) {
        setTree(previous);
        if (record) undoStack.current.pop();
        toast.error(result.error);
      } else {
        router.refresh();
      }
    });
  }

  // ── Alternativa accesible: subir / bajar por menú o Alt+↑↓ ───────────────

  function moveByOffset(row: Row, delta: -1 | 1) {
    const target = row.siblingIndex + delta;
    if (target < 0 || target >= row.siblingCount) return;
    applyMove(row.item, row.parentId, target);
  }

  // ── Agregar ───────────────────────────────────────────────────────────────

  /** «Agregar» del encabezado: siempre en la raíz. «Agregar dentro» (⋮ de una carpeta): en esa carpeta. */
  function addItem(kind: TreeItemKind, parentId: string | null = null) {
    if (kind === "folder" && folderDepthOf(tree, parentId) + 1 > MAX_FOLDER_DEPTH) {
      toast.error("Máximo dos niveles de carpetas");
      return;
    }
    const title = NEW_TITLES[kind] ?? "Nuevo elemento";
    startTransition(async () => {
      const result = await createItemAction({ courseId, parentId, kind, title });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      undoStack.current.push({ type: "create", itemId: result.itemId, title });
      if (parentId) expand(parentId);
      select(result.itemId, true);
      router.refresh();
    });
  }

  // ── Eliminar (con unos segundos para deshacer) ────────────────────────────

  function requestDelete(item: TreeItem) {
    setDeleteTarget(item);
  }

  /** Quita el ítem de la vista ya y lo borra en el servidor al terminar el plazo para deshacer. */
  function scheduleDelete(target: TreeItem) {
    const loc = locate(tree, target.id);
    if (!loc || pending.current.has(target.id)) return;
    const timer = window.setTimeout(() => void commitDelete(target.id), UNDO_DELETE_MS);
    pending.current.set(target.id, { item: target, parentId: loc.parentId, index: loc.index, timer });
    setTree((prev) => removeNode(prev, target.id).tree);
    undoStack.current.push({ type: "delete", itemId: target.id, title: target.title });
    if (clip?.itemId === target.id && clip.mode === "cut") setClip(null);
    if (selectedId && (selectedId === target.id || isDescendant(target, selectedId))) {
      router.push(pathname, { scroll: false });
    }
    toast(`Se eliminó «${target.title}»`, {
      id: `borrar-${target.id}`,
      duration: UNDO_DELETE_MS,
      action: { label: "Deshacer", onClick: () => undoDelete(target.id) },
    });
    panelRef.current?.focus();
  }

  async function commitDelete(id: string) {
    const p = pending.current.get(id);
    if (!p) return;
    pending.current.delete(id);
    const result = await deleteItemAction(courseId, id);
    if ("error" in result) toast.error(result.error);
    router.refresh();
  }

  function undoDelete(id: string): boolean {
    const p = pending.current.get(id);
    if (!p) return false;
    window.clearTimeout(p.timer);
    pending.current.delete(id);
    setTree((prev) => insertNode(prev, p.parentId, p.index, p.item));
    undoStack.current = undoStack.current.filter((e) => !(e.type === "delete" && e.itemId === id));
    toast.dismiss(`borrar-${id}`);
    toast.success(`Se restauró «${p.item.title}»`);
    return true;
  }

  function confirmDelete() {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (target) scheduleDelete(target);
  }

  // ── Deshacer ──────────────────────────────────────────────────────────────

  function undo() {
    const entry = undoStack.current.pop();
    if (!entry) {
      toast("No hay nada que deshacer");
      return;
    }
    if (entry.type === "move") {
      const item = findNode(tree, entry.itemId);
      if (!item) return undo();
      applyMove(item, entry.from.parentId, entry.from.index, false);
      toast(`Se deshizo el movimiento de «${entry.title}»`);
    } else if (entry.type === "create") {
      const item = findNode(tree, entry.itemId);
      if (!item) return undo();
      scheduleDelete(item);
    } else if (!undoDelete(entry.itemId)) {
      toast("Ese borrado ya se completó: ya no se puede deshacer");
    }
  }

  // ── Copiar, cortar, pegar, duplicar ───────────────────────────────────────

  function copy(item: TreeItem) {
    const next: Clip = { mode: "copy", courseId, itemId: item.id, title: item.title, kind: item.kind };
    setClip(next);
    writeClip(next);
    toast(`Copiado «${item.title}»: pégalo con Ctrl+V (también en otro curso)`);
  }

  function cut(item: TreeItem) {
    const next: Clip = { mode: "cut", courseId, itemId: item.id, title: item.title, kind: item.kind };
    setClip(next);
    writeClip(null);
    toast(`Cortado «${item.title}»: selecciona dónde va y pulsa Ctrl+V`);
  }

  /** Destino de «Pegar»: dentro de la carpeta seleccionada, o debajo del elemento seleccionado, o al final. */
  function pasteTarget(anchor: TreeItem | null): { parentId: string | null; index: number } {
    if (!anchor) return { parentId: null, index: tree.length };
    if (anchor.kind === "folder") return { parentId: anchor.id, index: anchor.children.length };
    const loc = locate(tree, anchor.id);
    return loc ? { parentId: loc.parentId, index: loc.index + 1 } : { parentId: null, index: tree.length };
  }

  function duplicateTo(
    source: { courseId: string; itemId: string; title: string },
    target: { parentId: string | null; index: number }
  ) {
    const toastId = toast.loading(`Copiando «${source.title}»…`);
    startTransition(async () => {
      const result = await duplicateItemAction({
        courseId,
        sourceCourseId: source.courseId,
        itemId: source.itemId,
        parentId: target.parentId,
        index: target.index,
      });
      if ("error" in result) {
        toast.error(result.error, { id: toastId });
        return;
      }
      if (result.missingFiles > 0) {
        toast.warning(
          `Se pegó «${result.title}», pero ${result.missingFiles === 1 ? "1 archivo del original ya no estaba" : `${result.missingFiles} archivos del original ya no estaban`} en el almacenamiento: súbelo de nuevo en la copia.`,
          { id: toastId, duration: 10000 }
        );
      } else {
        toast.success(`Se pegó «${result.title}»`, { id: toastId });
      }
      undoStack.current.push({ type: "create", itemId: result.itemId, title: result.title });
      if (target.parentId) expand(target.parentId);
      select(result.itemId, true);
      router.refresh();
    });
  }

  function paste(anchor: TreeItem | null) {
    const current = clip ?? readClip();
    if (!current) {
      toast("No hay nada copiado");
      return;
    }
    const target = pasteTarget(anchor);
    if (current.mode === "cut") {
      const item = findNode(tree, current.itemId);
      if (!item) {
        setClip(null);
        toast.error("Lo que cortaste ya no está en este curso");
        return;
      }
      if (target.parentId === item.id || (target.parentId !== null && isDescendant(item, target.parentId))) {
        toast.error("No se puede mover una carpeta dentro de sí misma");
        return;
      }
      if (!fitsDepth(tree, item, target.parentId)) {
        toast.error("Máximo dos niveles de carpetas");
        return;
      }
      // El índice se cuenta sin el propio elemento (como al arrastrar)
      const from = locate(tree, item.id);
      const index = from && from.parentId === target.parentId && from.index < target.index ? target.index - 1 : target.index;
      setClip(null);
      if (target.parentId) expand(target.parentId);
      applyMove(item, target.parentId, index);
      return;
    }
    const local = current.courseId === courseId ? findNode(tree, current.itemId) : null;
    if (local && !fitsDepth(tree, local, target.parentId)) {
      toast.error("Máximo dos niveles de carpetas");
      return;
    }
    duplicateTo(current, target);
  }

  function duplicate(item: TreeItem) {
    const loc = locate(tree, item.id);
    duplicateTo({ courseId, itemId: item.id, title: item.title }, { parentId: loc?.parentId ?? null, index: (loc?.index ?? tree.length) + 1 });
  }

  // ── Atajos de teclado (con el foco en el panel del árbol) ─────────────────

  function onKeyDown(e: React.KeyboardEvent) {
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, select, [contenteditable='true'], [role='menu']")) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    const idx = selectedId ? rows.findIndex((r) => r.item.id === selectedId) : -1;
    const row = idx >= 0 ? rows[idx] : null;

    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };

    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      if (row) moveByOffset(row, e.key === "ArrowUp" ? -1 : 1);
      return handled();
    }
    if (!mod && !e.altKey) {
      switch (e.key) {
        case "ArrowDown":
        case "ArrowUp": {
          if (rows.length === 0) return;
          const next = idx < 0 ? (e.key === "ArrowDown" ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, idx + (e.key === "ArrowDown" ? 1 : -1)));
          select(rows[next].item.id, true);
          return handled();
        }
        case "Home":
        case "End":
          if (rows.length) select(rows[e.key === "Home" ? 0 : rows.length - 1].item.id, true);
          return handled();
        case "ArrowRight":
          if (row?.item.kind === "folder") {
            if (collapsed.has(row.item.id)) expand(row.item.id);
            else if (row.item.children[0]) select(row.item.children[0].id, true);
          }
          return handled();
        case "ArrowLeft":
          if (row?.item.kind === "folder" && !collapsed.has(row.item.id) && row.item.children.length) {
            setCollapsed((prev) => new Set(prev).add(row.item.id));
          } else if (row?.parentId) {
            select(row.parentId, true);
          }
          return handled();
        case "Delete":
          if (row) requestDelete(row.item);
          return handled();
        case "F2":
          if (row) {
            const input = document.getElementById("item-title") as HTMLInputElement | null;
            input?.focus();
            input?.select();
          }
          return handled();
        case "Escape":
          if (clip?.mode === "cut") {
            setClip(null);
            toast("Se canceló el corte");
            return handled();
          }
          return;
        case "?":
          setShortcutsOpen((o) => !o);
          return handled();
      }
      return;
    }
    if (mod && !e.altKey) {
      if (key === "z" && !e.shiftKey) {
        undo();
        return handled();
      }
      if (key === "c" && row) {
        copy(row.item);
        return handled();
      }
      if (key === "x" && row) {
        cut(row.item);
        return handled();
      }
      if (key === "v") {
        paste(row?.item ?? null);
        return handled();
      }
      if (key === "d" && row) {
        duplicate(row.item);
        return handled();
      }
      if (e.key === "Backspace" && e.metaKey && row) {
        requestDelete(row.item);
        return handled();
      }
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  // Con el curso vacío el menú visible es el grande del centro; si no, el del
  // encabezado. Solo ese responde a ?agregar=1 (si no, se abrirían dos).
  const empty = rows.length === 0 && !activeId;

  function handleAddOpenChange(next: boolean) {
    setAddOpen(next);
    if (!next) clearUrlParam("agregar");
  }

  function openAddMenu() {
    setAddOpen(true);
  }

  useOpenDialogRequest("add-item", openAddMenu);

  const pasteAtEnd = clip ? () => paste(null) : undefined;

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="flex h-full min-h-80 flex-col rounded-xl border bg-card shadow-[0_1px_2px_rgb(15_23_42/0.05)] outline-none"
    >
      <OpenFromUrl param="agregar" onOpen={openAddMenu} />
      <div className="flex items-center justify-between border-b p-3">
        <p className="text-[11px] font-bold uppercase tracking-wider text-section-strong">
          Contenido del curso
        </p>
        <div className="flex items-center gap-1.5">
          <ShortcutsHelp open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
          <HelpTip topic="content.types" />
          <AddItemMenu
            onAdd={(kind) => addItem(kind, null)}
            open={!empty && addOpen}
            onOpenChange={handleAddOpenChange}
            clipTitle={clip?.title}
            onPaste={pasteAtEnd}
          />
        </div>
      </div>

      {empty ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <span className="anim-pop flex size-16 items-center justify-center rounded-full bg-section-soft text-section-strong">
            <FolderPlus className="size-8" aria-hidden />
          </span>
          <p className="max-w-56 text-sm text-muted-foreground">
            Empieza agregando una carpeta o una lección
          </p>
          <AddItemMenu
            onAdd={(kind) => addItem(kind, null)}
            primary
            open={empty && addOpen}
            onOpenChange={handleAddOpenChange}
            clipTitle={clip?.title}
            onPaste={pasteAtEnd}
          />
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          onDragCancel={() => {
            setActiveId(null);
            setDrop(null);
          }}
        >
          <SortableContext
            items={rows.map((r) => r.item.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul
              role="tree"
              aria-label="Árbol de contenido. Atajos: flechas, Ctrl+C, Ctrl+V, Supr, Ctrl+Z"
              className="flex-1 space-y-0.5 p-2"
            >
              {rows.map((row) => {
                const item = row.item;
                const canNestFolder = item.kind === "folder" && folderDepthOf(tree, item.id) + 1 <= MAX_FOLDER_DEPTH;
                return (
                  <TreeRow
                    key={item.id}
                    row={row}
                    selected={item.id === selectedId}
                    isDragging={item.id === activeId}
                    isCut={clip?.mode === "cut" && clip.itemId === item.id}
                    drop={drop?.overId === item.id ? drop : null}
                    collapsed={collapsed.has(item.id)}
                    docStatus={docStatus[item.id]}
                    onSelect={() => select(item.id)}
                    onToggle={() =>
                      setCollapsed((prev) => {
                        const next = new Set(prev);
                        if (next.has(item.id)) next.delete(item.id);
                        else next.add(item.id);
                        return next;
                      })
                    }
                    actions={{
                      addInside: item.kind === "folder" ? (kind) => addItem(kind, item.id) : undefined,
                      canNestFolder,
                      copy: () => copy(item),
                      cut: () => cut(item),
                      paste: clip ? () => paste(item) : undefined,
                      pasteLabel: item.kind === "folder" ? "Pegar dentro" : "Pegar debajo",
                      duplicate: () => duplicate(item),
                      moveUp: row.siblingIndex > 0 ? () => moveByOffset(row, -1) : undefined,
                      moveDown: row.siblingIndex < row.siblingCount - 1 ? () => moveByOffset(row, 1) : undefined,
                      remove: () => requestDelete(item),
                    }}
                  />
                );
              })}
            </ul>
          </SortableContext>

          <DragOverlay>
            {activeItem && (
              <div className="flex items-center gap-2 rounded-lg border bg-card px-2 py-1.5 text-sm shadow-md">
                <GripVertical className="size-4 text-muted-foreground" aria-hidden />
                <KindIcon kind={activeItem.kind} />
                <span className="max-w-64 truncate">{activeItem.title}</span>
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}

      {selected && clip?.mode === "cut" && clip.itemId !== selected.id && (
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">
          Moviendo «{clip.title}»: pulsa <kbd className="rounded border px-1">Ctrl</kbd>+<kbd className="rounded border px-1">V</kbd>{" "}
          para ponerlo {selected.kind === "folder" ? `dentro de «${selected.title}»` : `debajo de «${selected.title}»`} ·{" "}
          <kbd className="rounded border px-1">Esc</kbd> cancela
        </p>
      )}

      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent
          // Al cerrar, el foco vuelve al árbol (la fila borrada ya no existe): así
          // Ctrl+Z y las flechas siguen funcionando sin volver a hacer clic
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            panelRef.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar «{deleteTarget?.title}»?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.kind === "folder"
                ? "Se eliminará la carpeta con todo su contenido."
                : "Se eliminará con su contenido."}{" "}
              Tendrás unos segundos para deshacerlo (botón «Deshacer» o Ctrl+Z).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={confirmDelete}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Fila del árbol ──────────────────────────────────────────────────────────

type RowActions = {
  /** Solo carpetas: «Agregar dentro» */
  addInside?: (kind: TreeItemKind) => void;
  canNestFolder: boolean;
  copy: () => void;
  cut: () => void;
  paste?: () => void;
  pasteLabel: string;
  duplicate: () => void;
  moveUp?: () => void;
  moveDown?: () => void;
  remove: () => void;
};

function TreeRow({
  row,
  selected,
  isDragging,
  isCut,
  drop,
  collapsed,
  docStatus,
  onSelect,
  onToggle,
  actions,
}: {
  row: Row;
  selected: boolean;
  isDragging: boolean;
  isCut: boolean;
  drop: DropIndicator | null;
  collapsed: boolean;
  docStatus: DocStatus | undefined;
  onSelect: () => void;
  onToggle: () => void;
  actions: RowActions;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: row.item.id,
  });
  const { item, depth } = row;
  const isFolder = item.kind === "folder";
  const lineColor = drop?.invalid ? "bg-destructive" : "bg-section";

  return (
    <li
      ref={setNodeRef}
      role="treeitem"
      aria-selected={selected}
      aria-expanded={isFolder ? !collapsed : undefined}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        paddingLeft: depth * 20,
      }}
      className={cn("relative", (isDragging || isCut) && "opacity-40")}
    >
      {drop?.type === "before" && (
        <span className={cn("absolute inset-x-1 -top-0.5 z-10 h-0.5 rounded", lineColor)} aria-hidden />
      )}
      {drop?.type === "after" && (
        <span className={cn("absolute inset-x-1 -bottom-0.5 z-10 h-0.5 rounded", lineColor)} aria-hidden />
      )}

      <div
        className={cn(
          "group relative flex items-center gap-1 rounded-lg border border-transparent px-1 py-1 transition-colors",
          // Lección: acento sutil de 2px del color de su tipo (acompaña al icono)
          !isFolder && !selected && cn("border-l-2", kindMeta(item.kind).borderClass),
          // Carpeta: fila destacada como "sección" (división neutra café)
          isFolder && !selected && drop?.type !== "inside" && "bg-secondary/50",
          // Seleccionado: fondo suave de la sección + barra izquierda del color de sección
          selected
            ? "bg-section-soft before:absolute before:inset-y-1 before:left-0 before:w-1 before:rounded-full before:bg-section"
            : "hover:bg-section-soft/50",
          isCut && "border-dashed border-section",
          drop?.type === "inside" &&
            (drop.invalid ? "bg-destructive/10 ring-1 ring-destructive" : "bg-section-soft ring-1 ring-section")
        )}
      >
        <button
          type="button"
          className="cursor-grab touch-none rounded p-1 text-locked transition-colors hover:bg-section-soft hover:text-section-strong"
          aria-label={`Arrastrar «${item.title}»`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" aria-hidden />
        </button>

        {isFolder ? (
          <button
            type="button"
            onClick={onToggle}
            className="rounded p-0.5 text-muted-foreground hover:bg-muted"
            aria-label={collapsed ? `Expandir «${item.title}»` : `Contraer «${item.title}»`}
          >
            <ChevronRight
              className={cn("size-4 transition-transform", !collapsed && "rotate-90")}
              aria-hidden
            />
          </button>
        ) : (
          <span className="w-5" aria-hidden />
        )}

        <button
          type="button"
          onClick={onSelect}
          data-row-select={item.id}
          className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-0.5 text-left text-sm outline-none transition-colors hover:text-section-strong focus-visible:ring-2 focus-visible:ring-section/50"
        >
          <KindIcon kind={item.kind} />
          <span className={cn("truncate", isFolder && "font-semibold")}>{item.title}</span>
        </button>

        {item.kind === "document" && docStatus && <DocStatusIcon status={docStatus} />}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon-sm"
              variant="ghost"
              className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
              aria-label={`Opciones de «${item.title}»`}
            >
              <EllipsisVertical aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {actions.addInside && (
              <>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Plus aria-hidden />
                    Agregar dentro
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-56">
                    <AddKindItems onAdd={actions.addInside} folderDisabled={!actions.canNestFolder} />
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onSelect={actions.copy}>
              <Copy aria-hidden />
              Copiar
              <DropdownMenuShortcut>Ctrl+C</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={actions.cut}>
              <Scissors aria-hidden />
              Cortar
              <DropdownMenuShortcut>Ctrl+X</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!actions.paste} onSelect={() => actions.paste?.()}>
              <ClipboardPaste aria-hidden />
              {actions.pasteLabel}
              <DropdownMenuShortcut>Ctrl+V</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={actions.duplicate}>
              <CopyPlus aria-hidden />
              Duplicar
              <DropdownMenuShortcut>Ctrl+D</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!actions.moveUp} onSelect={() => actions.moveUp?.()}>
              Subir
              <DropdownMenuShortcut>Alt+↑</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!actions.moveDown} onSelect={() => actions.moveDown?.()}>
              Bajar
              <DropdownMenuShortcut>Alt+↓</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={actions.remove}>
              <Trash2 aria-hidden />
              Eliminar
              <DropdownMenuShortcut>Supr</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

function KindIcon({ kind }: { kind: TreeItemKind }) {
  const meta = kindMeta(kind);
  return <meta.Icon className={cn("size-4 shrink-0", meta.textClass)} aria-hidden />;
}

function DocStatusIcon({ status }: { status: DocStatus }) {
  if (!status.hasFile) return null;
  switch (status.status) {
    case "ready":
      return (
        <span title={status.pageCount ? `Listo · ${status.pageCount} páginas` : "Listo"}>
          <Check className="size-4 shrink-0 text-success" aria-label="Documento listo" />
        </span>
      );
    case "processing":
      return (
        <Loader2
          className="size-4 shrink-0 animate-spin text-section-strong"
          aria-label="Convirtiendo documento"
        />
      );
    case "error":
      return (
        <TriangleAlert
          className="size-4 shrink-0 text-destructive"
          aria-label="Error al procesar el documento"
        />
      );
    default:
      return (
        <Clock
          className="size-4 shrink-0 text-muted-foreground"
          aria-label="Documento en espera de conversión"
        />
      );
  }
}

// ─── Tipos que se pueden agregar ─────────────────────────────────────────────

function AddKindItems({
  onAdd,
  folderDisabled = false,
}: {
  onAdd: (kind: TreeItemKind) => void;
  /** Dentro de una subcarpeta ya no cabe otra carpeta (máximo dos niveles) */
  folderDisabled?: boolean;
}) {
  return (
    <>
      {/* Icono de cada tipo en su color de identidad (color + icono, nunca solo) */}
      <DropdownMenuItem onSelect={() => onAdd("folder")} disabled={folderDisabled}>
        <Folder className="text-section-strong" aria-hidden />
        Carpeta
        {folderDisabled && <span className="ml-auto text-[11px] text-muted-foreground">máx. 2 niveles</span>}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onAdd("document")}>
        <FileText className="text-kind-document" aria-hidden />
        Documento (PPT/PDF)
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onAdd("text")}>
        <AlignLeft className="text-kind-text" aria-hidden />
        Lectura
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onAdd("video")}>
        <Play className="text-kind-video" aria-hidden />
        Video por enlace
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onAdd("exam")}>
        <FileQuestion className="text-kind-exam" aria-hidden />
        Examen
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onAdd("assignment")}>
        <Upload className="text-kind-assignment" aria-hidden />
        Tarea
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => onAdd("resource")}>
        <KindChip kind="resource" size="sm" className="-ml-1" />
        Recurso descargable
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onAdd("link")}>
        <KindChip kind="link" size="sm" className="-ml-1" />
        Enlace externo
      </DropdownMenuItem>
    </>
  );
}

// ─── Menú "+ Agregar" (siempre en la raíz del curso) ─────────────────────────

function AddItemMenu({
  onAdd,
  primary = false,
  open,
  onOpenChange,
  clipTitle,
  onPaste,
}: {
  onAdd: (kind: TreeItemKind) => void;
  primary?: boolean;
  /** Controlado siempre: la guía lo abre con ?agregar=1 */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Hay algo copiado o cortado: se ofrece pegarlo al final */
  clipTitle?: string;
  onPaste?: () => void;
}) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        {primary ? (
          <Button className="h-11 bg-cta px-4 text-cta-foreground hover:bg-cta/90">
            <Plus aria-hidden />
            Agregar
          </Button>
        ) : (
          <Button variant="outline" size="sm">
            <Plus aria-hidden />
            Agregar
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <AddKindItems onAdd={onAdd} />
        {onPaste && clipTitle && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onPaste}>
              <ClipboardPaste aria-hidden />
              <span className="truncate">Pegar «{clipTitle}» al final</span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Lista de atajos ─────────────────────────────────────────────────────────

function ShortcutsHelp({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label="Atajos de teclado" title="Atajos de teclado (?)">
          <Keyboard aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <p className="mb-2 text-sm font-semibold">Atajos de teclado</p>
        <p className="mb-2 text-xs text-muted-foreground">Funcionan con un elemento del árbol seleccionado.</p>
        <dl className="space-y-1 text-sm">
          {SHORTCUTS.map(([keys, what]) => (
            <div key={keys} className="flex items-center justify-between gap-3">
              <dt>
                <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[11px] font-medium">{keys}</kbd>
              </dt>
              <dd className="text-right text-muted-foreground">{what}</dd>
            </div>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  );
}
