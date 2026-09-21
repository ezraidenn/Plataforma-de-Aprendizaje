import "server-only";
import { and, eq, type AnyColumn, type SQL } from "drizzle-orm";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { VIEW_ALL } from "@/lib/view-context";

type Actor = { id: string; role: string };

/**
 * De quién es el contenido que se LISTA (listas, tableros, conteos).
 * No decide permisos: abrir un curso por id sigue siendo getOwnedCourse.
 */
export type ViewScope =
  | { kind: "own"; ownerId: string } // maestro, o admin en «Mi contenido»
  | { kind: "teacher"; ownerId: string } // admin viendo como el maestro X
  | { kind: "all" }; // admin en «General — todos»

export function ownScope(user: Actor): ViewScope {
  return { kind: "own", ownerId: user.id };
}

/**
 * Todo lo que el usuario puede gestionar (admin: todo). Es para selectores de
 * PERMISO (p. ej. qué plantilla asignar a un curso), no para las listas del
 * contexto.
 */
export function fullScope(user: Actor): ViewScope {
  return user.role === "admin" ? { kind: "all" } : ownScope(user);
}

/**
 * Contexto a partir del valor de la cookie `vista`. Los maestros siempre ven lo
 * suyo. Un valor inválido (id inexistente o de alguien que no es maestro) cae a
 * «Mi contenido».
 */
export function resolveViewScope(user: Actor, cookieValue: string | undefined): ViewScope {
  if (user.role !== "admin" || !cookieValue) return ownScope(user);
  if (cookieValue === VIEW_ALL) return { kind: "all" };
  const teacher = db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, cookieValue), eq(users.role, "teacher")))
    .get();
  return teacher ? { kind: "teacher", ownerId: teacher.id } : ownScope(user);
}

/** Dueño cuyo contenido se lista (null = todos). */
export function scopeOwnerId(scope: ViewScope): string | null {
  return scope.kind === "all" ? null : scope.ownerId;
}

/** A nombre de quién queda lo que se crea: el maestro del contexto o uno mismo. */
export function actingOwnerId(scope: ViewScope, user: Actor): string {
  return scope.kind === "teacher" ? scope.ownerId : user.id;
}

/** Filtro por dueño para una columna `owner_id` (undefined = sin filtro). */
export function ownerCondition(scope: ViewScope, column: AnyColumn): SQL | undefined {
  const ownerId = scopeOwnerId(scope);
  return ownerId === null ? undefined : eq(column, ownerId);
}
