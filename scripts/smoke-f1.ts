/**
 * Prueba end-to-end de la Fase 1 contra los servicios reales (sin navegador):
 * curso → contenido → publicación → matrícula → candados → heartbeats con
 * reloj real → anti-trampa → completado.
 *
 * Uso: NODE_OPTIONS=--conditions=react-server pnpm exec tsx scripts/smoke-f1.ts
 * Crea un "Curso de demostración" que se deja en la base para probar en el
 * navegador (se recrea limpio en cada corrida).
 */
import { cleanupSmokeNotifications } from "./lib/smoke-cleanup";
import { eq } from "drizzle-orm";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { Readable } from "node:stream";

import { db } from "../src/server/db";
import { users, itemTexts, courses as coursesTable } from "../src/server/db/schema";
import * as courses from "../src/server/services/courses";
import * as tree from "../src/server/services/tree";
import * as progress from "../src/server/services/progress";
import { attachDocumentFile } from "../src/server/services/documents";
import { saveStream } from "../src/server/services/storage";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function makePdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`Página ${i} — contenido de demostración`, {
      x: 60,
      y: 700,
      size: 18,
      font,
    });
  }
  return Buffer.from(await doc.save());
}

async function main() {
  const teacher = db.select().from(users).where(eq(users.email, "maestro@empresa.local")).get();
  const student = db
    .select()
    .from(users)
    .where(eq(users.email, "estudiante@empresa.local"))
    .get();
  if (!teacher || !student) throw new Error("Ejecuta primero pnpm db:seed");

  // Recrear el curso demo desde cero
  const previous = db
    .select()
    .from(coursesTable)
    .where(eq(coursesTable.title, "Curso de demostración — Protocolo de incendios"))
    .all();
  for (const p of previous) courses.deleteCourse(p.id);

  console.log("\n— Estructura del curso");
  const course = courses.createCourse({
    ownerId: teacher.id,
    title: "Curso de demostración — Protocolo de incendios",
    description: "Curso creado por la prueba automática de Fase 1.",
  });

  const folder = tree.createItem({
    courseId: course.id,
    parentId: null,
    kind: "folder",
    title: "Módulo 1 — Fundamentos",
  });
  const lectura = tree.createItem({
    courseId: course.id,
    parentId: folder.id,
    kind: "text",
    title: "Bienvenida al curso",
  });
  db.update(itemTexts)
    .set({
      contentMd:
        "# Bienvenida\n\nEste curso cubre el **protocolo de incendios** de la empresa.\n\n- Lee cada documento completo\n- El orden es obligatorio",
      minReadSeconds: 0,
    })
    .where(eq(itemTexts.itemId, lectura.id))
    .run();

  const documento = tree.createItem({
    courseId: course.id,
    parentId: folder.id,
    kind: "document",
    title: "Manual de extintores",
  });

  const pdf = await makePdf(3);
  const saved = await saveStream({
    stream: Readable.from(pdf),
    originalName: "manual-extintores.pdf",
    mimeType: "application/pdf",
    kind: "course_source",
    uploadedBy: teacher.id,
  });
  const attach = await attachDocumentFile(documento.id, saved.id, teacher);
  check("PDF procesado con 3 páginas", attach.status === "ready" && attach.pageCount === 3);

  const order = tree.linearOrder(course.id).map((i) => i.title);
  check(
    "Orden lineal DFS correcto",
    JSON.stringify(order) === JSON.stringify(["Bienvenida al curso", "Manual de extintores"]),
    order.join(" | ")
  );

  console.log("\n— Publicación y matrícula");
  const pub = courses.publishCourse(course.id);
  check("Curso publicable (sin bloqueadores)", pub.ok);
  const enrolled = courses.enrollStudents(course.id, [student.id], teacher.id);
  check("Estudiante matriculado", enrolled === 1);
  check("Matrícula idempotente", courses.enrollStudents(course.id, [student.id], teacher.id) === 0);

  console.log("\n— Candados de secuencia");
  const a1 = progress.canAccess(course.id, student.id, lectura.id);
  check("Primer ítem accesible", a1.allowed);
  const a2 = progress.canAccess(course.id, student.id, documento.id);
  check(
    "Segundo ítem bloqueado por el primero",
    !a2.allowed && a2.reason === "locked" && a2.blockedBy.title === "Bienvenida al curso"
  );

  console.log("\n— Lectura de texto (min 0 s: completa al primer latido)");
  const t1 = progress.textHeartbeat({ courseId: course.id, studentId: student.id, itemId: lectura.id });
  check("Lectura completada", t1.completed && t1.percent === 100);
  check("Documento desbloqueado", progress.canAccess(course.id, student.id, documento.id).allowed);

  console.log("\n— Documento: acreditación con reloj del servidor (3 s/página)");
  let hb = progress.documentHeartbeat({
    courseId: course.id, studentId: student.id, itemId: documento.id, page: 1,
  });
  check("Primer latido no acredita nada", hb.creditedPages.length === 0 && hb.percent === 0);

  // Anti-trampa: latido inmediato (delta < 3 s) no acredita
  hb = progress.documentHeartbeat({
    courseId: course.id, studentId: student.id, itemId: documento.id, page: 2,
  });
  check("Pasar de página al instante NO acredita", hb.creditedPages.length === 0, JSON.stringify(hb));

  await sleep(3300); // permanencia real en página 2
  hb = progress.documentHeartbeat({
    courseId: course.id, studentId: student.id, itemId: documento.id, page: 1,
  });
  check("Página 2 acreditada tras 3 s reales", hb.creditedPages.includes(2), JSON.stringify(hb));

  await sleep(3300); // permanencia en página 1
  hb = progress.documentHeartbeat({
    courseId: course.id, studentId: student.id, itemId: documento.id, page: 3,
  });
  check("Página 1 acreditada", hb.creditedPages.includes(1), JSON.stringify(hb));
  check("Aún no completado (falta la 3)", !hb.completed && hb.percent === 67, `percent=${hb.percent}`);

  await sleep(3300); // permanencia en página 3
  hb = progress.documentHeartbeat({
    courseId: course.id, studentId: student.id, itemId: documento.id, page: 3,
  });
  check("Página 3 acreditada y lección COMPLETADA", hb.completed && hb.percent === 100, JSON.stringify(hb));

  console.log("\n— Resumen de curso");
  const summary = progress.courseProgress(course.id, student.id);
  check(
    "Progreso del curso 100% (2/2 requeridos)",
    summary.percent === 100 && summary.completedRequired === 2,
    JSON.stringify({ percent: summary.percent, done: summary.completedRequired })
  );

  console.log("\n— Reordenamiento del árbol");
  tree.moveItem({ courseId: course.id, itemId: documento.id, newParentId: folder.id, newIndex: 0 });
  const reordered = tree.linearOrder(course.id).map((i) => i.title);
  check(
    "moveItem reordena hermanos",
    JSON.stringify(reordered) === JSON.stringify(["Manual de extintores", "Bienvenida al curso"]),
    reordered.join(" | ")
  );
  tree.moveItem({ courseId: course.id, itemId: documento.id, newParentId: folder.id, newIndex: 1 });

  let depthError = "";
  try {
    const sub = tree.createItem({ courseId: course.id, parentId: folder.id, kind: "folder", title: "Sub" });
    tree.createItem({ courseId: course.id, parentId: sub.id, kind: "folder", title: "Sub-sub" });
  } catch (e) {
    depthError = e instanceof Error ? e.message : String(e);
  }
  check("Límite de 2 niveles de carpetas se aplica", depthError.includes("dos niveles"), depthError);

  console.log(
    failures === 0
      ? "\n✅ TODO PASÓ — el curso demo queda en la base para probar en el navegador"
      : `\n❌ ${failures} fallas`
  );
  // No dejar la campana de las cuentas demo llena de avisos de prueba
  cleanupSmokeNotifications([course.id]);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
