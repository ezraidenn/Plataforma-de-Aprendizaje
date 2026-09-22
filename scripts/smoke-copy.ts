/**
 * Copiar y pegar contenido (copia profunda): documento con su PDF, examen con
 * preguntas, carpeta completa, entre cursos, límite de dos niveles, sin copiar
 * el avance de los alumnos, archivo faltante y rutas legibles tras reubicar.
 * Borra todo lo que crea al terminar.
 *
 * Uso: pnpm smoke:copy   (necesita los datos de `pnpm seed:demo`)
 */
import fs from "node:fs";
import { eq, inArray, like } from "drizzle-orm";
import { db } from "../src/server/db";
import {
  courses as coursesTable,
  exams,
  files,
  itemDocuments,
  itemProgress,
  itemResourceFiles,
  questionOptions,
  questions,
  users,
} from "../src/server/db/schema";
import { deleteItem, duplicateItem, getItem, getItems } from "../src/server/services/tree";
import { absolutePathFor, deleteFile, getFileRecord } from "../src/server/services/storage";
import { layoutDrift, relocateCourseFiles, unreferencedFileIds } from "../src/server/services/storage-layout";

let failures = 0;
function check(name: string, cond: boolean, extra = "") {
  if (!cond) failures++;
  console.log(`  ${cond ? "✓" : "✗"} ${name}${extra ? `  · ${extra}` : ""}`);
}
async function rejects(fn: () => Promise<unknown>, text: string) {
  try {
    await fn();
    return false;
  } catch (e) {
    return (e as Error).message.includes(text);
  }
}
const count = (table: typeof questions | typeof questionOptions | typeof itemProgress, where: ReturnType<typeof eq>) =>
  db.select().from(table).where(where).all().length;

async function main() {
  const teacher = db.select().from(users).where(eq(users.email, "maestro@empresa.local")).get();
  const ext = db.select().from(coursesTable).where(like(coursesTable.title, "Uso y Manejo de Extintores%")).get();
  const pa = db.select().from(coursesTable).where(like(coursesTable.title, "Primeros Auxilios%")).get();
  if (!teacher || !ext || !pa) {
    console.log("❌ Faltan los datos demo: ejecuta `pnpm seed:demo`");
    process.exitCode = 1;
    return;
  }
  const created: string[] = [];
  const filesBefore = new Set(db.select({ id: files.id }).from(files).all().map((f) => f.id));
  const items = getItems(ext.id);
  const pdfDoc = items.find(
    (i) => i.kind === "document" && db.select().from(itemDocuments).where(eq(itemDocuments.itemId, i.id)).get()?.sourceFileId
  );
  const exam = items.find(
    (i) => i.kind === "exam" && db.select().from(questions).where(eq(questions.examItemId, i.id)).all().length > 0
  );
  const folder = items.find((i) => i.kind === "folder" && items.some((c) => c.parentId === i.id));
  const resource = items.find(
    (i) => i.kind === "resource" && db.select().from(itemResourceFiles).where(eq(itemResourceFiles.itemId, i.id)).get()
  );

  try {
    console.log("\n— Documento con su archivo");
    if (!pdfDoc) check("hay un documento con archivo en el demo", false);
    else {
      const srcDoc = db.select().from(itemDocuments).where(eq(itemDocuments.itemId, pdfDoc.id)).get()!;
      const r = await duplicateItem({ sourceItemId: pdfDoc.id, targetCourseId: ext.id, parentId: pdfDoc.parentId, index: 0, uploadedBy: teacher.id });
      created.push(r.item.id);
      const copyDoc = db.select().from(itemDocuments).where(eq(itemDocuments.itemId, r.item.id)).get()!;
      check("título «(copia)» en el mismo curso", r.item.title === `${pdfDoc.title} (copia)`);
      check("queda primero entre sus hermanos (índice 0)", getItems(ext.id).filter((i) => i.parentId === pdfDoc.parentId).sort((a, b) => a.position - b.position)[0]?.id === r.item.id);
      check("archivo propio (no comparte el del original)", !!copyDoc.sourceFileId && copyDoc.sourceFileId !== srcDoc.sourceFileId);
      const a = getFileRecord(srcDoc.sourceFileId!)!, b = getFileRecord(copyDoc.sourceFileId!)!;
      check("el archivo copiado es idéntico (hash)", a.sha256 === b.sha256 && a.sizeBytes === b.sizeBytes);
      check("existe en disco", fs.existsSync(absolutePathFor(b.storedPath)));
      if (srcDoc.renderFileId === srcDoc.sourceFileId) check("PDF: fuente y versión final son el mismo archivo nuevo", copyDoc.renderFileId === copyDoc.sourceFileId);
      else check("PPT: versión convertida también copiada", !!copyDoc.renderFileId && copyDoc.renderFileId !== srcDoc.renderFileId);
      check("conserva estado, páginas y segundos por página", copyDoc.processingStatus === srcDoc.processingStatus && copyDoc.pageCount === srcDoc.pageCount && copyDoc.minSecondsPerPage === srcDoc.minSecondsPerPage);
      check("no copia el avance de los alumnos", count(itemProgress, eq(itemProgress.itemId, r.item.id)) === 0, `original: ${count(itemProgress, eq(itemProgress.itemId, pdfDoc.id))} con avance`);
    }

    console.log("\n— Examen con preguntas");
    if (!exam) check("hay un examen con preguntas en el demo", false);
    else {
      db.update(exams).set({ resultsPublishedAt: new Date() }).where(eq(exams.itemId, exam.id)).run();
      const r = await duplicateItem({ sourceItemId: exam.id, targetCourseId: ext.id, parentId: exam.parentId, index: 99, uploadedBy: teacher.id });
      created.push(r.item.id);
      const qs = (id: string) => db.select().from(questions).where(eq(questions.examItemId, id)).all();
      const opts = (id: string) => qs(id).reduce((n, q) => n + count(questionOptions, eq(questionOptions.questionId, q.id)), 0);
      check("mismas preguntas", qs(r.item.id).length === qs(exam.id).length, `${qs(exam.id).length} preguntas`);
      check("mismas opciones", opts(r.item.id) === opts(exam.id), `${opts(exam.id)} opciones`);
      check("preguntas nuevas (ids distintos)", qs(r.item.id).every((q) => !qs(exam.id).some((o) => o.id === q.id)));
      check("mismo texto, orden y respuestas correctas", JSON.stringify(qs(r.item.id).map((q) => [q.position, q.promptMd, q.config])) === JSON.stringify(qs(exam.id).map((q) => [q.position, q.promptMd, q.config])));
      const settings = (id: string) => db.select().from(exams).where(eq(exams.itemId, id)).get()!;
      check("misma configuración (intentos, mínimo, tiempo)", settings(r.item.id).maxAttempts === settings(exam.id).maxAttempts && settings(r.item.id).passScore === settings(exam.id).passScore && settings(r.item.id).timeLimitMinutes === settings(exam.id).timeLimitMinutes);
      check("la copia empieza sin resultados publicados", settings(r.item.id).resultsPublishedAt === null);
      check("índice fuera de rango: queda al final", getItems(ext.id).filter((i) => i.parentId === exam.parentId).sort((a, b) => a.position - b.position).at(-1)?.id === r.item.id);
      db.update(exams).set({ resultsPublishedAt: null }).where(eq(exams.itemId, exam.id)).run();
    }

    console.log("\n— Carpeta completa");
    if (!folder) check("hay una carpeta con contenido en el demo", false);
    else {
      const subtree = (rootId: string, list = getItems(ext.id)): string[] => [rootId, ...list.filter((i) => i.parentId === rootId).flatMap((c) => subtree(c.id, list))];
      const before = subtree(folder.id);
      const r = await duplicateItem({ sourceItemId: folder.id, targetCourseId: ext.id, parentId: null, index: 1, uploadedBy: teacher.id });
      created.push(r.item.id);
      const after = subtree(r.item.id);
      check("copia todo el contenido", after.length === before.length, `${before.length} elementos`);
      check("mismos títulos en el mismo orden", JSON.stringify(after.slice(1).map((id) => getItem(id)!.title)) === JSON.stringify(before.slice(1).map((id) => getItem(id)!.title)));
      check("los hijos cuelgan de la carpeta nueva", after.slice(1).every((id) => getItem(id)!.parentId !== folder.id));
      check("en la posición 1 de la raíz", getItems(ext.id).filter((i) => i.parentId === null).sort((a, b) => a.position - b.position)[1]?.id === r.item.id);
      check("carpeta pegada dentro de sí misma (se copia la foto de antes)", await (async () => {
        const inner = await duplicateItem({ sourceItemId: folder.id, targetCourseId: ext.id, parentId: folder.id, index: 0, uploadedBy: teacher.id }).catch((e: Error) => e);
        if (inner instanceof Error) return inner.message.includes("dos niveles");
        created.push(inner.item.id);
        return subtree(inner.item.id).length === before.length;
      })());
    }

    console.log("\n— Entre cursos");
    if (exam) {
      const r = await duplicateItem({ sourceItemId: exam.id, targetCourseId: pa.id, parentId: null, index: 0, uploadedBy: teacher.id });
      created.push(r.item.id);
      check("se pega en otro curso", getItem(r.item.id)?.courseId === pa.id);
      check("en otro curso conserva el título", r.item.title === exam.title);
    }

    console.log("\n— Reglas");
    const nested = getItems(ext.id).find((i) => i.kind === "folder" && i.parentId !== null);
    const withSub = getItems(ext.id).find((i) => i.kind === "folder" && getItems(ext.id).some((c) => c.parentId === i.id && c.kind === "folder"));
    if (withSub && folder) {
      check("una carpeta con subcarpetas no cabe dentro de otra", await rejects(() => duplicateItem({ sourceItemId: withSub.id, targetCourseId: ext.id, parentId: folder.id, index: 0, uploadedBy: teacher.id }), "dos niveles"));
    } else if (nested && folder) {
      check("una carpeta no cabe en el tercer nivel", await rejects(() => duplicateItem({ sourceItemId: folder.id, targetCourseId: ext.id, parentId: nested.id, index: 0, uploadedBy: teacher.id }), "dos niveles"));
    } else {
      console.log("  (el demo no tiene subcarpetas: se omite la prueba de niveles)");
    }
    if (pdfDoc) check("no se puede pegar dentro de una lección", await rejects(() => duplicateItem({ sourceItemId: pdfDoc.id, targetCourseId: ext.id, parentId: pdfDoc.id, index: 0, uploadedBy: teacher.id }), "carpeta"));

    console.log("\n— Archivo faltante");
    if (pdfDoc) {
      // El PDF desaparece del disco: la copia no falla, avisa y queda sin archivo
      const srcDoc = db.select().from(itemDocuments).where(eq(itemDocuments.itemId, pdfDoc.id)).get()!;
      const abs = absolutePathFor(getFileRecord(srcDoc.sourceFileId!)!.storedPath);
      const backup = `${abs}.respaldo-prueba`;
      fs.renameSync(abs, backup);
      try {
        const r = await duplicateItem({ sourceItemId: pdfDoc.id, targetCourseId: ext.id, parentId: pdfDoc.parentId, index: 0, uploadedBy: teacher.id });
        created.push(r.item.id);
        const copyDoc = db.select().from(itemDocuments).where(eq(itemDocuments.itemId, r.item.id)).get()!;
        check("no falla: avisa del archivo que falta", r.missingFiles === 1, `faltantes=${r.missingFiles}`);
        check("la copia queda sin archivo y pendiente (para subirlo de nuevo)", copyDoc.sourceFileId === null && copyDoc.processingStatus === "pending");
      } finally {
        fs.renameSync(backup, abs);
      }
    }
    if (resource) {
      const rf = db.select().from(itemResourceFiles).where(eq(itemResourceFiles.itemId, resource.id)).all();
      const r = await duplicateItem({ sourceItemId: resource.id, targetCourseId: ext.id, parentId: resource.parentId, index: 0, uploadedBy: teacher.id });
      created.push(r.item.id);
      check("recurso: copia todos sus archivos", db.select().from(itemResourceFiles).where(eq(itemResourceFiles.itemId, r.item.id)).all().length === rf.length);
    }

    console.log("\n— Rutas legibles");
    const moved = await relocateCourseFiles(ext.id);
    check("se reubican sin errores", moved.failed === 0, `${moved.moved} movido(s)`);
    const copiedFileIds = new Set(
      db.select({ s: itemDocuments.sourceFileId }).from(itemDocuments).where(inArray(itemDocuments.itemId, getItems(ext.id).map((i) => i.id))).all().map((d) => d.s)
    );
    const drift = layoutDrift().filter((d) => copiedFileIds.has(d.fileId));
    check("ningún archivo queda fuera de su ruta (sin choques entre original y copia)", drift.length === 0, drift.map((d) => d.to).join(" | "));
    const again = await relocateCourseFiles(ext.id);
    check("reubicar otra vez no mueve nada (estable)", again.moved === 0, `${again.moved} movido(s)`);
  } finally {
    // Deja la base como estaba. En la plataforma, el worker (cleanup_files) retira
    // los archivos de lo borrado; aquí no corre, así que se hace a mano, SOLO con
    // los archivos que creó esta prueba y que ya nada usa.
    for (const id of created.reverse()) if (getItem(id)) deleteItem(getItem(id)!.courseId, id);
    let removedFiles = 0;
    for (const fileId of unreferencedFileIds()) {
      if (filesBefore.has(fileId)) continue;
      await deleteFile(fileId);
      removedFiles++;
    }
    await relocateCourseFiles(ext.id).catch(() => {});
    console.log(`  limpieza: ${created.length} copia(s) y ${removedFiles} archivo(s) borrados`);
  }

  if (failures) {
    console.log(`\n❌ ${failures} falla(s)`);
    process.exitCode = 1;
    return;
  }
  console.log("\n✅ COPIAR Y PEGAR OK");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
