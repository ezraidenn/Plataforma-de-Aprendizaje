import "server-only";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { ownScope, scopeOwnerId, type ViewScope } from "@/server/auth/view-scope";

/**
 * Dos reglas distintas sobre la MISMA base de alumnos:
 *
 * - Pool (`studentInPoolCondition`): el directorio. Cualquier maestro encuentra
 *   a cualquier alumno, lo registre quien lo registre, para abrir su ficha y
 *   matricularlo. Solo expone datos de la cuenta (nombre, correo, estado); lo
 *   que se ve de sus cursos lo sigue filtrando el contexto.
 * - Mis alumnos (`studentVisibleCondition`): los que el maestro dio de alta más
 *   los que tienen o tuvieron matrícula (cualquier estado o ciclo) en alguno de
 *   sus cursos. Rige reportes, avisos, historial, certificados, conteos y los
 *   permisos sobre la cuenta (`studentAccountPermissions`).
 */

/** Pool: toda cuenta con rol alumno. */
export const studentInPoolCondition: SQL = eq(users.role, "student");

export function isStudentInPool(studentId: string): boolean {
  return Boolean(
    db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, studentId), studentInPoolCondition))
      .get()
  );
}

/**
 * SQL: el alumno («users») es de `ownerId` — alta propia o matrícula en uno de
 * sus cursos. OJO: en subconsultas correlacionadas la columna externa va
 * calificada a mano («"users"."id"»), como en latestCycleOnly. Requiere que
 * «users» vaya sin alias y sea la fila del alumno.
 */
export function ownStudentSql(ownerId: string): SQL {
  return sql`(${users.createdBy} = ${ownerId} OR EXISTS (
    SELECT 1 FROM enrollments e JOIN courses c ON c.id = e.course_id
    WHERE e.student_id = "users"."id" AND c.owner_id = ${ownerId}
  ))`;
}

/** Mis alumnos del contexto («General»: todos). */
export function studentVisibleCondition(scope: ViewScope): SQL {
  const ownerId = scopeOwnerId(scope);
  if (ownerId === null) return studentInPoolCondition;
  return and(studentInPoolCondition, ownStudentSql(ownerId))!;
}

/**
 * Alumnos visibles por dueño en UNA consulta. MISMA regla que
 * studentVisibleCondition: rol alumno y (alta propia o cualquier matrícula —
 * cualquier estado o ciclo — en un curso del dueño). UNION quita los pares
 * repetidos (alta + matrícula, varias matrículas). Si cambias una, cambia la
 * otra: pnpm smoke:scope compara ambas para cada maestro.
 */
export function visibleStudentCountsByOwner(): Map<string, number> {
  const rows = db.all<{ ownerId: string; n: number }>(sql`
    SELECT owner_id AS ownerId, COUNT(*) AS n FROM (
      SELECT u.created_by AS owner_id, u.id AS student_id
        FROM users u
       WHERE u.role = 'student' AND u.created_by IS NOT NULL
      UNION
      SELECT c.owner_id, e.student_id
        FROM enrollments e
        JOIN courses c ON c.id = e.course_id
        JOIN users u ON u.id = e.student_id
       WHERE u.role = 'student'
    )
    GROUP BY owner_id
  `);
  return new Map(rows.map((r) => [r.ownerId, r.n]));
}

export function isStudentVisible(scope: ViewScope, studentId: string): boolean {
  return Boolean(
    db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, studentId), studentVisibleCondition(scope)))
      .get()
  );
}

/** SQL: el alumno («users») tiene matrícula vigente (no dada de baja) con OTRO dueño. */
export function sharedElsewhereSql(ownerId: string): SQL {
  return sql`EXISTS (
    SELECT 1 FROM enrollments e JOIN courses c ON c.id = e.course_id
    WHERE e.student_id = "users"."id" AND e.status != 'dropped' AND c.owner_id != ${ownerId}
  )`;
}

export function isSharedElsewhere(ownerId: string, studentId: string): boolean {
  return Boolean(
    db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, studentId), sharedElsewhereSql(ownerId)))
      .get()
  );
}

export type StudentAccountPermissions = {
  /**
   * El alumno es del usuario (alta propia o matrícula en sus cursos) o el
   * usuario es admin. Un alumno del pool que no es suyo lo ve y lo matricula,
   * pero no toca su cuenta.
   */
  mine: boolean;
  /** Restablecer: solo si es exclusivo (a un compartido lo restablece el admin) */
  canResetPassword: boolean;
  /** Reactivar nunca perjudica a otro maestro */
  canActivate: boolean;
  /** Desactivar le cerraría también los cursos de otros maestros */
  canDeactivate: boolean;
};

/**
 * Qué puede hacer el usuario con la CUENTA del alumno (no con su lugar en un
 * curso). Admin: todo. Maestro, si es su alumno: reactivar siempre;
 * restablecer y desactivar solo si además no toma cursos con otro maestro (le
 * afectaría esos cursos: una contraseña nueva cierra sus sesiones y le da
 * acceso a quien la tenga).
 */
export function studentAccountPermissions(
  user: { id: string; role: string },
  studentId: string
): StudentAccountPermissions {
  if (user.role === "admin") {
    return { mine: true, canResetPassword: true, canActivate: true, canDeactivate: true };
  }
  if (!isStudentVisible(ownScope(user), studentId)) {
    return { mine: false, canResetPassword: false, canActivate: false, canDeactivate: false };
  }
  const shared = isSharedElsewhere(user.id, studentId);
  return {
    mine: true,
    canResetPassword: !shared,
    canActivate: true,
    canDeactivate: !shared,
  };
}
