import "server-only";
import { nanoid } from "nanoid";
import { db } from "@/server/db";
import { jobs } from "@/server/db/schema";

/** Encolar un job (módulo ligero: importable desde cualquier servicio). */
export function enqueueJob(
  type: (typeof jobs.$inferInsert)["type"],
  payload: Record<string, unknown>
) {
  db.insert(jobs).values({ id: nanoid(), type, payload }).run();
}
