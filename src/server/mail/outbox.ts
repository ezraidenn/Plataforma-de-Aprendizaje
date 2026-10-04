import "server-only";
import { and, asc, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/server/db";
import { certificates, courseItems, courses, emailLog, enrollments, users } from "@/server/db/schema";
import { appUrl } from "@/server/services/app-url";
import { MailError, mailConfigured, sendMail } from "./client";
import * as M from "./messages";
import type { Rendered } from "./render";
import { issueToken } from "./tokens";

/**
 * Bandeja de salida. Cada correo es una fila de `email_log`: se encola con los
 * datos mínimos y se arma al enviarlo (con la dirección actual del servidor y
 * los datos vigentes). Un carril propio la vacía, uno por uno, sin estorbar a
 * las conversiones de archivos; si el servicio se cae o marca límite, espera y
 * reintenta.
 */

export type MailKind =
  | "bienvenida"
  | "restablecer"
  | "cambio_cuenta"
  | "inscripcion"
  | "certificado"
  | "vencimiento"
  | "pendientes"
  | "resumen"
  | "aviso"
  | "prueba";

/** Correos que la persona puede apagar en Ajustes (los de cuenta y seguridad no). */
const PREF = {
  vencimiento: "mailExpiry",
  pendientes: "mailReminders",
  resumen: "mailDigest",
  aviso: "mailNotices",
} as const satisfies Partial<Record<MailKind, keyof typeof users.$inferSelect>>;

/** Correo que ya no vale la pena mandar si se atrasó tanto (minutos). */
const STALE_MIN: Partial<Record<MailKind, number>> = {
  restablecer: 60,
  pendientes: 12 * 60,
  resumen: 8 * 60,
};

/** Direcciones de prueba y de demostración: nunca salen. */
export function isTestAddress(email: string): boolean {
  return /@(example\.(com|org|net)|[^@]*\.(local|test|invalid|example|localhost))$/i.test(email.trim());
}

type Queued = { id: string; status: "pendiente" | "omitido"; reason?: string };
export type QueueResult = Queued | null;
export type AccessMailResult = (Queued & { mode?: "bienvenida" | "restablecer" }) | null;

/**
 * Encola un correo para una persona. Devuelve null si no corresponde (cuenta
 * inactiva, aviso apagado en Ajustes o ya se mandó ese mismo correo).
 */
export function queueMail(opts: {
  kind: MailKind;
  userId: string;
  /** Para no repetir: con `once`, no se encola si ya hay uno igual pendiente o enviado */
  ref?: string;
  once?: boolean;
  payload?: Record<string, unknown>;
  /** Otra dirección (el aviso de cambio de correo va a la anterior) */
  to?: string;
  /** No antes de esta hora (para juntar inscripciones seguidas en un correo) */
  runAfter?: Date;
}): QueueResult {
  const user = db.select().from(users).where(eq(users.id, opts.userId)).get();
  if (!user || !user.active) return null;
  const pref = PREF[opts.kind as keyof typeof PREF];
  if (pref && !user[pref]) return null;

  const ref = opts.ref ?? "";
  if (opts.once) {
    const dup = db
      .select({ id: emailLog.id })
      .from(emailLog)
      .where(
        and(
          eq(emailLog.userId, opts.userId),
          eq(emailLog.kind, opts.kind),
          eq(emailLog.ref, ref),
          inArray(emailLog.status, ["pendiente", "enviado"])
        )
      )
      .get();
    if (dup) return null;
  }

  const to = (opts.to ?? user.email).trim().toLowerCase();
  const reason = !mailConfigured()
    ? "El correo no está configurado en el servidor."
    : isTestAddress(to)
      ? "Dirección de prueba: no se envía."
      : null;
  const id = nanoid();
  db.insert(emailLog)
    .values({
      id,
      userId: opts.userId,
      kind: opts.kind,
      ref,
      toAddress: to,
      payload: opts.payload ?? {},
      status: reason ? "omitido" : "pendiente",
      error: reason,
      runAfter: opts.runAfter ?? null,
    })
    .run();
  if (!reason) kickMailLane();
  return { id, status: reason ? "omitido" : "pendiente", ...(reason ? { reason } : {}) };
}

/**
 * «Enviar acceso por correo» (maestro o admin): quien nunca ha entrado recibe
 * otra vez la bienvenida (enlace sin caducidad); quien ya entraba, un enlace
 * para elegir contraseña nueva que vale 24 horas. El último enlace anula a los
 * anteriores.
 */
export function queueAccessMail(userId: string, requestedBy: string): AccessMailResult {
  const user = db.select({ lastLoginAt: users.lastLoginAt }).from(users).where(eq(users.id, userId)).get();
  if (!user) return null;
  if (!user.lastLoginAt) {
    const r = queueMail({ kind: "bienvenida", userId });
    return r && { ...r, mode: "bienvenida" };
  }
  const r = queueMail({ kind: "restablecer", userId, payload: { minutes: 24 * 60, requestedBy } });
  return r && { ...r, mode: "restablecer" };
}

/**
 * «¿Olvidaste tu contraseña?» desde la pantalla de entrada. No dice si el
 * correo existe; como freno, una solicitud cada 5 minutos y 5 al día por
 * cuenta.
 */
export function requestPasswordReset(email: string, now = Date.now()) {
  const user = db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, email.trim().toLowerCase()), eq(users.active, true)))
    .get();
  if (!user) return;
  const recent = db
    .select({ createdAt: emailLog.createdAt })
    .from(emailLog)
    .where(and(eq(emailLog.userId, user.id), eq(emailLog.kind, "restablecer"), gte(emailLog.createdAt, new Date(now - 86_400_000))))
    .all();
  if (recent.length >= 5 || recent.some((r) => r.createdAt.getTime() > now - 5 * 60_000)) return;
  queueMail({ kind: "restablecer", userId: user.id, payload: { minutes: 60 } });
}

/** Texto para la interfaz tras encolar un correo de acceso. */
export function accessMailMessage(r: AccessMailResult, email: string): { sent: boolean; message: string } {
  if (!r) return { sent: false, message: "No se envió el correo: la cuenta está desactivada." };
  if (r.status === "omitido") return { sent: false, message: `No se envió el correo: ${r.reason?.replace(/\.$/, "").toLowerCase()}.` };
  return {
    sent: true,
    message:
      r.mode === "restablecer"
        ? `Se envió a ${email} un enlace para elegir contraseña nueva (vale 24 horas).`
        : `Se envió a ${email} el correo de bienvenida para crear su contraseña.`,
  };
}

/** Una persona inscrita en varios cursos seguidos recibe un solo correo. */
const ENROLL_GATHER_MS = 2 * 60_000;

/** Encola (o agrega al que está por salir) el aviso de inscripción. */
export function queueEnrollmentMail(userId: string, enrollmentId: string) {
  const waiting = db
    .select({ id: emailLog.id, payload: emailLog.payload })
    .from(emailLog)
    .where(
      and(
        eq(emailLog.userId, userId),
        eq(emailLog.kind, "inscripcion"),
        eq(emailLog.status, "pendiente"),
        eq(emailLog.attempts, 0),
        gte(emailLog.runAfter, new Date())
      )
    )
    .get();
  if (waiting) {
    const ids = new Set(((waiting.payload as { enrollmentIds?: string[] }).enrollmentIds ?? []));
    ids.add(enrollmentId);
    db.update(emailLog)
      .set({ payload: { enrollmentIds: [...ids] } })
      .where(eq(emailLog.id, waiting.id))
      .run();
    return;
  }
  queueMail({
    kind: "inscripcion",
    userId,
    payload: { enrollmentIds: [enrollmentId] },
    runAfter: new Date(Date.now() + ENROLL_GATHER_MS),
  });
}

// ─── Fechas ──────────────────────────────────────────────────────────────────

export const TZ = "America/Merida";

export function fmtDate(d: Date | number): string {
  return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "long", year: "numeric", timeZone: TZ }).format(d);
}

export function fmtDateTime(d: Date | number): string {
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: TZ,
  }).format(d);
}

// ─── Armado ──────────────────────────────────────────────────────────────────

type Row = typeof emailLog.$inferSelect;
type Built = Rendered & { expiresInMinutes?: number };

/** No se arma (el curso o el certificado ya no existe…): se marca omitido. */
class Skip extends Error {}
/** Aún no (p. ej. el curso sigue en borrador): se vuelve a intentar más tarde. */
class Later extends Error {
  constructor(readonly minutes: number) {
    super("más tarde");
  }
}

function courseUrl(base: string, courseId: string) {
  return `${base}/courses/${courseId}`;
}

async function build(row: Row): Promise<Built> {
  const base = await appUrl();
  const user = row.userId ? db.select().from(users).where(eq(users.id, row.userId)).get() : null;
  if (!user) throw new Skip("La cuenta ya no existe.");
  if (!user.active) throw new Skip("La cuenta está desactivada.");
  const p = row.payload as Record<string, unknown>;

  switch (row.kind as MailKind) {
    case "bienvenida": {
      const token = issueToken({ userId: user.id, purpose: "invite", mailId: row.id, expiresAt: null });
      return M.bienvenida({ fullName: user.fullName, email: user.email, role: user.role, url: `${base}/crear-contrasena?t=${token}` });
    }
    case "restablecer": {
      const minutes = Number(p.minutes) || 60;
      const token = issueToken({
        userId: user.id,
        purpose: "reset",
        mailId: row.id,
        expiresAt: new Date(row.createdAt.getTime() + minutes * 60_000),
      });
      const left = Math.max(5, Math.round((row.createdAt.getTime() + minutes * 60_000 - Date.now()) / 60_000));
      return {
        ...M.restablecer({
          fullName: user.fullName,
          email: user.email,
          url: `${base}/restablecer?t=${token}`,
          minutes,
          requestedBy: (p.requestedBy as string) || null,
        }),
        expiresInMinutes: left,
      };
    }
    case "cambio_cuenta": {
      const what = p.what === "email" ? "email" : "password";
      return M.cambioCuenta({
        fullName: user.fullName,
        what,
        when: fmtDateTime(Number(p.at) || row.createdAt.getTime()),
        account: String(p.account ?? user.email),
        newEmail: p.newEmail ? String(p.newEmail) : undefined,
        recoverUrl: what === "password" ? `${base}/recuperar` : base,
      });
    }
    case "inscripcion": {
      const ids = (p.enrollmentIds as string[] | undefined) ?? [];
      if (ids.length === 0) throw new Skip("Sin cursos.");
      const rows = db
        .select({
          enrollmentId: enrollments.id,
          status: enrollments.status,
          courseId: courses.id,
          title: courses.title,
          courseStatus: courses.status,
          validityMode: courses.validityMode,
          validityMonths: courses.validityMonths,
          teacher: users.fullName,
        })
        .from(enrollments)
        .innerJoin(courses, eq(enrollments.courseId, courses.id))
        .innerJoin(users, eq(courses.ownerId, users.id))
        .where(and(inArray(enrollments.id, ids), ne(enrollments.status, "dropped")))
        .all();
      const ready = rows.filter((r) => r.courseStatus === "published");
      const drafts = rows.filter((r) => r.courseStatus === "draft");
      if (ready.length === 0) {
        // Inscrito en un curso que aún no se publica: el aviso sale al publicarlo
        if (drafts.length > 0 && Date.now() - row.createdAt.getTime() < 60 * 86_400_000) throw new Later(30);
        throw new Skip("Los cursos ya no están disponibles.");
      }
      if (drafts.length > 0) {
        // Lo publicado sale ahora; lo que sigue en borrador, en otro correo
        queueMail({ kind: "inscripcion", userId: user.id, payload: { enrollmentIds: drafts.map((d) => d.enrollmentId) }, runAfter: new Date(Date.now() + 30 * 60_000) });
      }
      const lessons = new Map(
        db
          .select({ courseId: courseItems.courseId, n: sql<number>`COUNT(*)` })
          .from(courseItems)
          .where(and(inArray(courseItems.courseId, ready.map((r) => r.courseId)), ne(courseItems.kind, "folder"), eq(courseItems.visible, true)))
          .groupBy(courseItems.courseId)
          .all()
          .map((r) => [r.courseId, r.n])
      );
      return M.inscripcion({
        fullName: user.fullName,
        email: user.email,
        courses: ready.map((r) => ({
          title: r.title,
          teacher: r.teacher,
          lessons: lessons.get(r.courseId) ?? 0,
          validity:
            r.validityMode === "months" && r.validityMonths
              ? `${r.validityMonths} ${r.validityMonths === 1 ? "mes" : "meses"}`
              : r.validityMode === "calendar_year"
                ? "hasta fin de año"
                : null,
          url: courseUrl(base, r.courseId),
        })),
        dashboardUrl: `${base}/dashboard`,
      });
    }
    case "certificado":
    case "vencimiento": {
      const cert = db
        .select({ c: certificates, title: courses.title })
        .from(certificates)
        .innerJoin(courses, eq(certificates.courseId, courses.id))
        .where(eq(certificates.id, String(p.certificateId ?? "")))
        .get();
      if (!cert || cert.c.revoked) throw new Skip("El certificado ya no está vigente.");
      if (row.kind === "certificado") {
        return M.certificado({
          fullName: user.fullName,
          course: cert.title,
          folio: cert.c.folio,
          issued: fmtDate(cert.c.issuedAt),
          validUntil: cert.c.expiresAt ? fmtDate(cert.c.expiresAt) : null,
          courseUrl: `${base}/dashboard#certificados`,
          verifyUrl: `${base}/verify/${encodeURIComponent(cert.c.folio)}`,
        });
      }
      if (!cert.c.expiresAt || cert.c.expiresAt.getTime() < Date.now()) throw new Skip("El certificado ya venció.");
      if (cert.c.renewalState !== "pending") throw new Skip("Ya se gestionó la recertificación.");
      return M.vencimiento({
        fullName: user.fullName,
        course: cert.title,
        folio: cert.c.folio,
        issued: fmtDate(cert.c.issuedAt),
        expires: fmtDate(cert.c.expiresAt),
        daysLeft: Math.max(1, Math.ceil((cert.c.expiresAt.getTime() - Date.now()) / 86_400_000)),
        courseUrl: `${base}/dashboard#certificados`,
      });
    }
    case "pendientes": {
      const items = (p.items as { kind: "exam" | "assignment" | "returned"; title: string; course: string; when: string; detail?: string; path: string }[]) ?? [];
      if (items.length === 0) throw new Skip("Sin pendientes.");
      return M.pendientes({
        fullName: user.fullName,
        items: items.map(({ path, ...it }) => ({ ...it, url: `${base}${path}` })),
        dashboardUrl: `${base}/dashboard`,
      });
    }
    case "resumen": {
      const d = p as {
        toGrade: { course: string; detail: string }[];
        toGradeTotal: number;
        finished: { total: number; text: string; path: string } | null;
        expiring: { total: number; text: string } | null;
      };
      return M.resumenMaestro({
        fullName: user.fullName,
        toGrade: d.toGrade ?? [],
        toGradeTotal: d.toGradeTotal ?? 0,
        finished: d.finished ? { total: d.finished.total, text: d.finished.text, url: `${base}${d.finished.path}` } : null,
        expiring: d.expiring,
        urls: { grading: `${base}/teach/grading`, renewals: `${base}/teach/renewals`, dashboard: `${base}/teach/dashboard` },
      });
    }
    case "aviso": {
      const courseId = p.courseId ? String(p.courseId) : null;
      return M.aviso({
        title: String(p.title ?? "Aviso"),
        message: String(p.message ?? ""),
        from: String(p.from ?? "Tu instructor"),
        course: p.courseTitle ? String(p.courseTitle) : null,
        courseUrl: courseId ? courseUrl(base, courseId) : null,
      });
    }
    case "prueba":
      return M.prueba({ fullName: user.fullName, url: base });
    default:
      throw new Skip(`Tipo de correo desconocido: ${row.kind}`);
  }
}

/** Vista previa sin enviar ni dejar huella (smoke y pantalla de pruebas). */
export async function previewMail(row: Row): Promise<Built> {
  return build(row);
}

// ─── Carril de envío ─────────────────────────────────────────────────────────

/** Límites de la llave: 500 al día y 100 por minuto (se va muy por debajo). */
const DAILY_CAP = 480;
const TICK_MS = 1_500;
const MAX_ATTEMPTS = 8;
const BACKOFF_MIN = [1, 2, 5, 15, 30, 60, 120, 240];

/** Pausa general: el servicio pidió esperar o no responde. */
let pausedUntil = 0;
let warnedCap = false;

function finish(id: string, set: Partial<typeof emailLog.$inferInsert>) {
  db.update(emailLog).set(set).where(eq(emailLog.id, id)).run();
}

/** Envía el siguiente correo pendiente, si toca. Devuelve true si mandó (o intentó) uno. */
export async function sendNextMail(now = Date.now()): Promise<boolean> {
  if (now < pausedUntil || !mailConfigured()) return false;

  const sentToday =
    db
      .select({ n: sql<number>`COUNT(*)` })
      .from(emailLog)
      .where(and(eq(emailLog.status, "enviado"), gte(emailLog.sentAt, new Date(now - 86_400_000))))
      .get()?.n ?? 0;
  if (sentToday >= DAILY_CAP) {
    if (!warnedCap) console.warn("[correo] se alcanzó el límite diario; los demás esperan");
    warnedCap = true;
    return false;
  }
  warnedCap = false;

  const row = db
    .select()
    .from(emailLog)
    .where(and(eq(emailLog.status, "pendiente"), or(isNull(emailLog.runAfter), lte(emailLog.runAfter, new Date(now)))))
    .orderBy(asc(emailLog.createdAt))
    .limit(1)
    .get();
  if (!row) return false;

  const stale = STALE_MIN[row.kind as MailKind];
  if (stale && now - row.createdAt.getTime() > stale * 60_000) {
    finish(row.id, { status: "omitido", error: "Se atrasó demasiado y ya no tenía caso enviarlo." });
    return true;
  }

  let mail: Built;
  try {
    mail = await build(row);
  } catch (err) {
    if (err instanceof Later) {
      finish(row.id, { runAfter: new Date(now + err.minutes * 60_000) });
    } else {
      finish(row.id, { status: err instanceof Skip ? "omitido" : "fallido", error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  try {
    const { id } = await sendMail({
      to: row.toAddress,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      idempotencyKey: `educountry-${row.id}`,
      expiresInMinutes: mail.expiresInMinutes,
    });
    finish(row.id, { status: "enviado", subject: mail.subject, providerId: id, sentAt: new Date(), error: null, attempts: row.attempts + 1 });
  } catch (err) {
    const e = err instanceof MailError ? err : new MailError(String(err), "retry", null, null);
    const attempts = row.attempts + 1;
    if (e.action === "wait") {
      // Límite de la llave: todo el carril espera, este correo no pierde turno
      pausedUntil = now + (e.retryAfterSec ?? 60) * 1000;
      finish(row.id, { subject: mail.subject, error: e.message, runAfter: new Date(pausedUntil) });
    } else if (e.action === "retry" && attempts < MAX_ATTEMPTS) {
      if (e.status === null) pausedUntil = now + 60_000; // servicio caído: no insistir cada segundo
      finish(row.id, {
        subject: mail.subject,
        error: e.message,
        attempts,
        runAfter: new Date(now + BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)] * 60_000),
      });
    } else {
      finish(row.id, { status: "fallido", subject: mail.subject, error: e.message, attempts });
      console.error(`[correo] no se pudo enviar ${row.kind} a ${row.toAddress}: ${e.message}`);
    }
  }
  return true;
}

/** Solo para las pruebas: olvida la pausa general. */
export function resetMailPause() {
  pausedUntil = 0;
}

let laneStarted = false;
let laneBusy = false;
let kickTimer: ReturnType<typeof setTimeout> | null = null;

async function laneTick() {
  if (laneBusy) return;
  laneBusy = true;
  try {
    await sendNextMail();
  } catch (err) {
    console.error("[correo] error en el carril:", err);
  } finally {
    laneBusy = false;
  }
}

/** Despierta el carril en cuanto se encola algo (sin esperar al siguiente tick). */
function kickMailLane() {
  if (!laneStarted || kickTimer) return;
  kickTimer = setTimeout(() => {
    kickTimer = null;
    void laneTick();
  }, 200);
  kickTimer.unref?.();
}

/** Arranca el carril de correos (una vez por proceso; lo llama el worker). */
export function startMailLane() {
  if (laneStarted) return;
  laneStarted = true;
  setInterval(() => void laneTick(), TICK_MS);
  console.log(`[correo] carril iniciado (${mailConfigured() ? "configurado" : "sin configurar: no se envía nada"})`);
}

/** Para Admin → Configuración. */
export function mailStats() {
  const since = new Date(Date.now() - 86_400_000);
  const count = (status: Row["status"], recent = true) =>
    db
      .select({ n: sql<number>`COUNT(*)` })
      .from(emailLog)
      .where(and(eq(emailLog.status, status), recent ? gte(emailLog.createdAt, since) : sql`1=1`))
      .get()?.n ?? 0;
  return {
    configured: mailConfigured(),
    sent24h: count("enviado"),
    failed24h: count("fallido"),
    pending: count("pendiente", false),
    dailyCap: DAILY_CAP,
  };
}

export const MAIL_KIND_LABEL: Record<MailKind, string> = {
  bienvenida: "Bienvenida",
  restablecer: "Restablecer contraseña",
  cambio_cuenta: "Cambio en la cuenta",
  inscripcion: "Inscripción",
  certificado: "Certificado",
  vencimiento: "Certificado por vencer",
  pendientes: "Pendientes",
  resumen: "Resumen del maestro",
  aviso: "Aviso del maestro",
  prueba: "Prueba",
};

/** Últimos correos para Admin → Configuración. */
export function listRecentMails(limit = 25) {
  return db
    .select({
      id: emailLog.id,
      kind: emailLog.kind,
      toAddress: emailLog.toAddress,
      subject: emailLog.subject,
      status: emailLog.status,
      error: emailLog.error,
      attempts: emailLog.attempts,
      createdAt: emailLog.createdAt,
      sentAt: emailLog.sentAt,
      userName: users.fullName,
    })
    .from(emailLog)
    .leftJoin(users, eq(emailLog.userId, users.id))
    .orderBy(sql`${emailLog.createdAt} DESC`)
    .limit(limit)
    .all();
}

/** Servidor del servicio de correo, sin la clave (para mostrarlo). */
export function mailServiceHost(): string | null {
  try {
    return process.env.CORREO_API_URL ? new URL(process.env.CORREO_API_URL).host : null;
  } catch {
    return null;
  }
}
