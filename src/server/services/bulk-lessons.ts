import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { itemDocuments, itemTexts } from "@/server/db/schema";
import { getTree, getItem, updateItem, type TreeNode } from "./tree";
import { BOM, csvLine, parseCsv, columnGetter, parseBoolEs } from "./csv-core";
import { audit } from "./audit";

/**
 * Edición masiva de lecciones por CSV (Excel):
 * export → editar columnas → import aplica cambios.
 *
 * Columnas: id (NO tocar), carpeta (informativa), tipo (informativa),
 *   titulo, requerido (SI/NO), secuencia (heredar|obligatoria|libre),
 *   visible (SI/NO), segundos_minimos (documentos: por página; lecturas: total)
 *
 * La estructura (crear/mover/borrar) se maneja en el editor visual; el CSV
 * edita PROPIEDADES de forma trazable y segura.
 */

const KIND_LABEL: Record<string, string> = {
  folder: "carpeta",
  document: "documento",
  text: "lectura",
  video: "video",
  exam: "examen",
  assignment: "tarea",
};

const SEQ_TO_CSV = { inherit: "heredar", required: "obligatoria", free: "libre" } as const;
const CSV_TO_SEQ: Record<string, "inherit" | "required" | "free"> = {
  heredar: "inherit",
  obligatoria: "required",
  obligatorio: "required",
  libre: "free",
};

export function exportLessonsCsv(courseId: string): string {
  const lines = [
    csvLine(["id", "carpeta", "tipo", "titulo", "requerido", "secuencia", "visible", "segundos_minimos"]),
  ];

  const walk = (nodes: TreeNode[], folderTitle: string) => {
    for (const node of nodes) {
      if (node.kind === "folder") {
        lines.push(
          csvLine([node.id, folderTitle, "carpeta", node.title, "", "", node.visible, ""])
        );
        walk(node.children, node.title);
        continue;
      }
      let minSeconds: number | "" = "";
      if (node.kind === "document") {
        minSeconds =
          db.select().from(itemDocuments).where(eq(itemDocuments.itemId, node.id)).get()
            ?.minSecondsPerPage ?? "";
      } else if (node.kind === "text") {
        minSeconds =
          db.select().from(itemTexts).where(eq(itemTexts.itemId, node.id)).get()
            ?.minReadSeconds ?? "";
      }
      lines.push(
        csvLine([
          node.id,
          folderTitle,
          KIND_LABEL[node.kind],
          node.title,
          node.requiredForCompletion,
          SEQ_TO_CSV[node.sequenceMode],
          node.visible,
          minSeconds,
        ])
      );
    }
  };
  walk(getTree(courseId), "");

  return BOM + lines.join("\r\n");
}

export type LessonCsvRow = {
  line: number;
  itemId: string;
  title: string;
  status: "ok" | "unchanged" | "invalid";
  message: string;
  changes: string[];
};

type LessonPatch = {
  itemId: string;
  item?: Partial<Parameters<typeof updateItem>[2]>;
  minSeconds?: number;
};

function analyzeRows(courseId: string, csvText: string): { rows: LessonCsvRow[]; patches: LessonPatch[] } {
  const parsed = parseCsv(csvText, { maxRows: 1000 });
  const col = columnGetter(parsed.headers, {
    id: ["id"],
    titulo: ["titulo", "title"],
    requerido: ["requerido", "obligatorio_para_completar"],
    secuencia: ["secuencia"],
    visible: ["visible"],
    segundos_minimos: ["segundos_minimos", "segundos", "seg_minimos"],
  });
  if (!col.has("id")) throw new Error('Falta la columna "id" — exporta primero para obtener la plantilla');

  const rows: LessonCsvRow[] = [];
  const patches: LessonPatch[] = [];

  for (const { line, cells } of parsed.rows) {
    const itemId = col.get(cells, "id").trim();
    const title = col.get(cells, "titulo").trim();
    const fail = (message: string) =>
      rows.push({ line, itemId, title, status: "invalid", message, changes: [] });

    const item = itemId ? getItem(itemId) : null;
    if (!item || item.courseId !== courseId) {
      fail("El id no pertenece a este curso (no edites la columna id)");
      continue;
    }

    const changes: string[] = [];
    const patch: LessonPatch = { itemId };
    const itemPatch: NonNullable<LessonPatch["item"]> = {};

    if (title && title !== item.title) {
      if (title.length < 2) {
        fail("El título es demasiado corto");
        continue;
      }
      itemPatch.title = title;
      changes.push(`título → "${title.length > 30 ? title.slice(0, 27) + "…" : title}"`);
    }

    if (item.kind !== "folder") {
      const reqRaw = col.get(cells, "requerido");
      if (reqRaw.trim() !== "") {
        const req = parseBoolEs(reqRaw);
        if (req === null) {
          fail(`"requerido" debe ser SI o NO (dice "${reqRaw}")`);
          continue;
        }
        if (req !== item.requiredForCompletion) {
          itemPatch.requiredForCompletion = req;
          changes.push(`requerido → ${req ? "SI" : "NO"}`);
        }
      }

      const seqRaw = col.get(cells, "secuencia").toLowerCase().trim();
      if (seqRaw) {
        const seq = CSV_TO_SEQ[seqRaw];
        if (!seq) {
          fail(`"secuencia" debe ser heredar, obligatoria o libre (dice "${seqRaw}")`);
          continue;
        }
        if (seq !== item.sequenceMode) {
          itemPatch.sequenceMode = seq;
          changes.push(`secuencia → ${seqRaw}`);
        }
      }

      const secRaw = col.get(cells, "segundos_minimos").trim();
      if (secRaw && (item.kind === "document" || item.kind === "text")) {
        const sec = parseInt(secRaw, 10);
        if (!Number.isFinite(sec) || sec < 0 || sec > 3600) {
          fail(`"segundos_minimos" inválido (dice "${secRaw}")`);
          continue;
        }
        const current =
          item.kind === "document"
            ? db.select().from(itemDocuments).where(eq(itemDocuments.itemId, item.id)).get()
                ?.minSecondsPerPage
            : db.select().from(itemTexts).where(eq(itemTexts.itemId, item.id)).get()?.minReadSeconds;
        if (sec !== current) {
          patch.minSeconds = sec;
          changes.push(`segundos → ${sec}`);
        }
      }
    }

    const visRaw = col.get(cells, "visible");
    if (visRaw.trim() !== "") {
      const vis = parseBoolEs(visRaw);
      if (vis === null) {
        fail(`"visible" debe ser SI o NO`);
        continue;
      }
      if (vis !== item.visible) {
        itemPatch.visible = vis;
        changes.push(`visible → ${vis ? "SI" : "NO"}`);
      }
    }

    if (Object.keys(itemPatch).length > 0) patch.item = itemPatch;
    if (changes.length === 0) {
      rows.push({ line, itemId, title: item.title, status: "unchanged", message: "Sin cambios", changes: [] });
    } else {
      rows.push({ line, itemId, title: item.title, status: "ok", message: changes.join(" · "), changes });
      patches.push(patch);
    }
  }

  return { rows, patches };
}

export function validateLessonsCsv(courseId: string, csvText: string) {
  const { rows } = analyzeRows(courseId, csvText);
  return {
    rows,
    ok: rows.filter((r) => r.status === "ok").length,
    unchanged: rows.filter((r) => r.status === "unchanged").length,
    invalid: rows.filter((r) => r.status === "invalid").length,
  };
}

export function importLessonsCsv(opts: {
  actorId: string;
  courseId: string;
  csvText: string;
}): { updated: number } {
  const { patches } = analyzeRows(opts.courseId, opts.csvText);

  db.transaction(() => {
    for (const patch of patches) {
      if (patch.item) updateItem(opts.courseId, patch.itemId, patch.item);
      if (patch.minSeconds !== undefined) {
        const item = getItem(patch.itemId)!;
        if (item.kind === "document") {
          db.update(itemDocuments)
            .set({ minSecondsPerPage: patch.minSeconds })
            .where(eq(itemDocuments.itemId, patch.itemId))
            .run();
        } else if (item.kind === "text") {
          db.update(itemTexts)
            .set({ minReadSeconds: patch.minSeconds })
            .where(eq(itemTexts.itemId, patch.itemId))
            .run();
        }
      }
    }
  });

  audit(opts.actorId, "import_lessons_csv", "course_items", opts.courseId, {
    updated: patches.length,
  });

  return { updated: patches.length };
}
