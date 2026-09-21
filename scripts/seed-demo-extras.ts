/**
 * Agrega al curso demo (Uso y Manejo de Extintores) un Recurso descargable y
 * un Enlace externo, como material opcional del Módulo 3. Idempotente.
 * Uso: NODE_OPTIONS=--conditions=react-server pnpm exec tsx scripts/seed-demo-extras.ts
 */
import { Readable } from "node:stream";
import { and, eq, like } from "drizzle-orm";
import { db } from "@/server/db";
import { courseItems, courses, users } from "@/server/db/schema";
import { createItem, updateItem } from "@/server/services/tree";
import { addResourceFile, updateLink } from "@/server/services/resources";
import { saveStream } from "@/server/services/storage";

const course = db.select().from(courses).where(like(courses.title, "Uso y Manejo%")).get();
if (!course) throw new Error("No existe el curso demo");
const teacher = db.select().from(users).where(eq(users.email, "maestro@empresa.local")).get()!;

const folders = db
  .select()
  .from(courseItems)
  .where(and(eq(courseItems.courseId, course.id), eq(courseItems.kind, "folder")))
  .all()
  .sort((a, b) => a.position - b.position);
const parent = folders[folders.length - 1] ?? null;

const existingResource = db
  .select()
  .from(courseItems)
  .where(and(eq(courseItems.courseId, course.id), eq(courseItems.kind, "resource")))
  .get();
const existingLink = db
  .select()
  .from(courseItems)
  .where(and(eq(courseItems.courseId, course.id), eq(courseItems.kind, "link")))
  .get();

async function file(name: string, mime: string, content: string) {
  return saveStream({
    stream: Readable.from([Buffer.from(content, "utf8")]),
    originalName: name,
    mimeType: mime,
    kind: "resource",
    uploadedBy: teacher.id,
  });
}

(async () => {
  if (!existingResource) {
    const item = createItem({
      courseId: course.id,
      parentId: parent?.id ?? null,
      kind: "resource",
      title: "Formatos de inspección mensual (descargables)",
    });
    updateItem(course.id, item.id, {
      description: "Formato de revisión de extintores y bitácora de brigada. Descarga cualquiera para marcar el recurso como visto.",
      requiredForCompletion: false,
    });
    const csv = await file(
      "formato-inspeccion-mensual.csv",
      "text/csv",
      "Área,Extintor,Tipo,Capacidad,Manómetro,Sello,Manguera,Fecha de recarga,Observaciones\nNave 2,E-12,PQS,4.5 kg,Verde,OK,OK,2026-03-01,Señal caída\n"
    );
    const txt = await file(
      "bitacora-brigada.txt",
      "text/plain",
      "Bitácora de brigada contra incendios\nFecha | Integrante | Actividad | Firma\n"
    );
    addResourceFile(item.id, csv.id, teacher);
    addResourceFile(item.id, txt.id, teacher);
    console.log("✓ Recurso creado:", item.title);
  } else {
    console.log("— Recurso ya existía");
  }

  if (!existingLink) {
    const item = createItem({
      courseId: course.id,
      parentId: parent?.id ?? null,
      kind: "link",
      title: "Texto oficial de la NOM-002-STPS-2010 (STPS)",
    });
    updateItem(course.id, item.id, { requiredForCompletion: false });
    updateLink(item.id, {
      url: "https://www.dof.gob.mx/normasOficiales/4217/stps/stps.htm",
      description: "Consulta la norma completa en el Diario Oficial de la Federación. Se marca como visto al abrirla.",
    });
    console.log("✓ Enlace creado:", item.title);
  } else {
    console.log("— Enlace ya existía");
  }
})();
