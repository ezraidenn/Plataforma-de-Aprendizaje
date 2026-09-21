import "server-only";
import { and, asc, eq, inArray, isNotNull, sql, type SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/server/db";
import { ownerCondition, type ViewScope } from "@/server/auth/view-scope";
import { certificates, cohorts, courses, enrollments, users } from "@/server/db/schema";
import { matchesSearch } from "@/server/db/search";
import { EXPIRING_WINDOW_DAYS } from "@/lib/validity";
import { latestCycleOnly } from "./enrollment-scope";
import { audit } from "./audit";
import { findOrCreateCohort, getCohort } from "./cohorts";

/**
 * Panel de vencimientos. Sin avisos ni reinscripciones automáticas: el maestro
 * decide caso por caso (la persona pudo darse de baja, o recibirá otro curso
 * que cubre una norma nueva).
 */

export type RenewalTab = "expiring" | "expired";

export const DISMISS_REASONS = {
  baja: "Ya no labora en la empresa",
  reemplazado: "Lo cubre otro curso",
  no_aplica: "Ya no aplica a su puesto",
  otro: "Otro motivo",
} as const;
export type DismissReason = keyof typeof DISMISS_REASONS;

export type RenewalRow = {
  certificateId: string;
  folio: string;
  expiresAt: Date;
  issuedAt: Date;
  cycle: number;
  enrollmentId: string;
  studentId: string;
  studentName: string;
  email: string;
  studentActive: boolean;
  courseId: string;
  courseTitle: string;
  cohortId: string | null;
  cohortName: string | null;
};

function baseConditions(scope: ViewScope): SQL[] {
  const conds: SQL[] = [
    eq(certificates.revoked, false),
    eq(certificates.renewalState, "pending"),
    isNotNull(certificates.expiresAt),
    // Solo el certificado del ciclo vigente: si ya hay un ciclo nuevo, se atendió
    latestCycleOnly,
  ];
  const owner = ownerCondition(scope, courses.ownerId);
  if (owner) conds.push(owner);
  return conds;
}

function tabCondition(tab: RenewalTab, now: number): SQL {
  const horizon = now + EXPIRING_WINDOW_DAYS * 86_400_000;
  return tab === "expired"
    ? sql`${certificates.expiresAt} < ${now}`
    : sql`${certificates.expiresAt} >= ${now} AND ${certificates.expiresAt} <= ${horizon}`;
}

export function listRenewals(
  scope: ViewScope,
  opts: { tab: RenewalTab; courseId?: string; cohortId?: string; search?: string }
): RenewalRow[] {
  const now = Date.now();
  const conds = [...baseConditions(scope), tabCondition(opts.tab, now)];
  if (opts.courseId) conds.push(eq(certificates.courseId, opts.courseId));
  if (opts.cohortId === "none") conds.push(sql`${enrollments.cohortId} IS NULL`);
  else if (opts.cohortId) conds.push(eq(enrollments.cohortId, opts.cohortId));
  const match = matchesSearch(opts.search, [users.fullName, users.email, courses.title]);
  if (match) conds.push(match);

  return db
    .select({
      certificateId: certificates.id,
      folio: certificates.folio,
      expiresAt: sql<Date>`${certificates.expiresAt}`.mapWith(certificates.expiresAt),
      issuedAt: certificates.issuedAt,
      cycle: enrollments.cycle,
      enrollmentId: enrollments.id,
      studentId: users.id,
      studentName: users.fullName,
      email: users.email,
      studentActive: users.active,
      courseId: courses.id,
      courseTitle: courses.title,
      cohortId: enrollments.cohortId,
      cohortName: cohorts.name,
    })
    .from(certificates)
    .innerJoin(enrollments, eq(certificates.enrollmentId, enrollments.id))
    .innerJoin(users, eq(enrollments.studentId, users.id))
    .innerJoin(courses, eq(certificates.courseId, courses.id))
    .leftJoin(cohorts, eq(enrollments.cohortId, cohorts.id))
    .where(and(...conds))
    .orderBy(asc(certificates.expiresAt), asc(users.fullName))
    .all() as RenewalRow[];
}

/** Conteos para el menú y las pestañas (informativos: no son notificaciones). */
export function renewalCounts(scope: ViewScope): { expiring: number; expired: number } {
  const now = Date.now();
  const count = (tab: RenewalTab) =>
    db
      .select({ n: sql<number>`COUNT(*)` })
      .from(certificates)
      .innerJoin(enrollments, eq(certificates.enrollmentId, enrollments.id))
      .innerJoin(courses, eq(certificates.courseId, courses.id))
      .where(and(...baseConditions(scope), tabCondition(tab, now)))
      .get()?.n ?? 0;
  return { expiring: count("expiring"), expired: count("expired") };
}

/** Certificados que el usuario puede gestionar (dueño del curso o admin). */
function ownedPending(user: { id: string; role: string }, certificateIds: string[]) {
  if (certificateIds.length === 0) return [];
  return db
    .select({ cert: certificates, enrollment: enrollments, ownerId: courses.ownerId })
    .from(certificates)
    .innerJoin(enrollments, eq(certificates.enrollmentId, enrollments.id))
    .innerJoin(courses, eq(certificates.courseId, courses.id))
    .where(and(inArray(certificates.id, certificateIds), eq(certificates.renewalState, "pending")))
    .all()
    .filter((r) => user.role === "admin" || r.ownerId === user.id);
}

/**
 * Reinscribe: abre el ciclo siguiente (progreso, intentos y entregas en cero)
 * en el grupo elegido. El ciclo anterior y su certificado quedan intactos.
 */
/**
 * Grupo del ciclo nuevo. Los grupos son de cada curso, así que se resuelve por
 * curso: «new» crea (o reutiliza) un grupo con ese nombre en CADA curso de la
 * selección; «existing» solo vale para certificados de ese mismo curso.
 */
export type RenewCohort =
  | { mode: "keep" }
  | { mode: "none" }
  | { mode: "existing"; cohortId: string }
  | { mode: "new"; name: string };

export function renewCertificates(
  user: { id: string; role: string },
  certificateIds: string[],
  cohort: RenewCohort = { mode: "keep" }
): { renewed: number; skipped: number } {
  let renewed = 0;
  let skipped = 0;
  const now = new Date();
  const existing = cohort.mode === "existing" ? getCohort(cohort.cohortId) : null;
  if (cohort.mode === "existing" && !existing?.courseId) throw new Error("El grupo elegido no existe");
  const byName = new Map<string, string>(); // courseId → grupo creado/reutilizado
  const cohortFor = (courseId: string, current: string | null): string | null => {
    switch (cohort.mode) {
      case "keep":
        return current;
      case "none":
        return null;
      case "existing":
        if (existing!.courseId !== courseId) throw new Error("El grupo elegido es de otro curso");
        return existing!.id;
      case "new": {
        if (!byName.has(courseId)) byName.set(courseId, findOrCreateCohort(courseId, cohort.name, user.id));
        return byName.get(courseId)!;
      }
    }
  };
  db.transaction(() => {
    for (const { cert, enrollment } of ownedPending(user, certificateIds)) {
      const latest =
        db
          .select({ cycle: sql<number>`MAX(${enrollments.cycle})` })
          .from(enrollments)
          .where(
            and(eq(enrollments.courseId, enrollment.courseId), eq(enrollments.studentId, enrollment.studentId))
          )
          .get()?.cycle ?? enrollment.cycle;
      // Si ya existe un ciclo posterior, alguien lo atendió antes
      if (latest > enrollment.cycle) {
        skipped++;
        continue;
      }
      const newId = nanoid();
      const newCohortId = cohortFor(enrollment.courseId, enrollment.cohortId);
      db.insert(enrollments)
        .values({
          id: newId,
          courseId: enrollment.courseId,
          studentId: enrollment.studentId,
          enrolledBy: user.id,
          cycle: enrollment.cycle + 1,
          cohortId: newCohortId,
        })
        .run();
      db.update(certificates)
        .set({ renewalState: "renewed", renewalAt: now, renewedEnrollmentId: newId })
        .where(eq(certificates.id, cert.id))
        .run();
      audit(user.id, "renew_certificate", "certificates", cert.id, {
        folio: cert.folio,
        newCycle: enrollment.cycle + 1,
        cohortId: newCohortId,
      });
      renewed++;
    }
  });
  return { renewed, skipped };
}

/** Descarta del panel con motivo. Sale de la vista y queda en el historial. */
export function dismissCertificates(
  user: { id: string; role: string },
  certificateIds: string[],
  reason: DismissReason,
  note?: string
): number {
  const label = DISMISS_REASONS[reason] ?? DISMISS_REASONS.otro;
  const text = note?.trim() ? `${label}: ${note.trim()}` : label;
  let n = 0;
  const now = new Date();
  db.transaction(() => {
    for (const { cert } of ownedPending(user, certificateIds)) {
      db.update(certificates)
        .set({ renewalState: "dismissed", renewalAt: now, renewalNote: text })
        .where(eq(certificates.id, cert.id))
        .run();
      audit(user.id, "dismiss_renewal", "certificates", cert.id, { folio: cert.folio, reason, note: note ?? null });
      n++;
    }
  });
  return n;
}
