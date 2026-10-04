/**
 * Prueba de los correos: armado (reglas del servicio, escape, enlaces), cliente
 * de la API con respuestas simuladas, bandeja de salida (reintentos, límites,
 * duplicados, preferencias), enlaces de un solo uso y revisiones diarias.
 *
 * Nunca llama al servicio real: todo envío pasa por un fetch simulado.
 * ESCRIBE EN LA BASE: córrela sobre una copia (DATABASE_PATH).
 *
 * Uso: pnpm smoke:mail
 */
import { and, eq, like } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../src/server/db";
import { certificates, courses as coursesTable, emailLog, enrollments, exams, users } from "../src/server/db/schema";
import * as courses from "../src/server/services/courses";
import * as tree from "../src/server/services/tree";
import { MailError, sendMail, setMailFetch } from "../src/server/mail/client";
import * as M from "../src/server/mail/messages";
import {
  isTestAddress,
  queueAccessMail,
  queueMail,
  requestPasswordReset,
  resetMailPause,
  sendNextMail,
} from "../src/server/mail/outbox";
import { checkToken, consumeToken, tokenFor } from "../src/server/mail/tokens";
import { collectPending, localNow, runExpiryMails, teacherDigest, whenLabel } from "../src/server/mail/scheduler";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const BASE = "http://10.0.0.10:3000";
const DOMAIN = "correo-smoke.mx"; // dominio que NO cuenta como de prueba (para que se encole)
const P = `smk${Date.now().toString(36)}`;

/** Reglas del servicio para el HTML de contenido. */
function htmlProblems(html: string): string[] {
  const out: string[] = [];
  if (/<\/?(html|body|head|style|script|form|input)\b/i.test(html)) out.push("etiqueta prohibida");
  if (/display\s*:\s*none|visibility\s*:|(?<![-\w])position\s*:|(?<![-\w])transform\s*:|direction\s*:\s*rtl/i.test(html)) out.push("estilo prohibido");
  if (/float\s*:/i.test(html.replace(/<img[^>]*>/gi, ""))) out.push("float fuera de img");
  if (/margin[^;:"]*:\s*-/i.test(html)) out.push("margen negativo");
  for (const m of html.matchAll(/opacity\s*:\s*([\d.]+)/gi)) if (Number(m[1]) < 0.8) out.push("opacidad baja");
  for (const m of html.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px/gi)) if (Number(m[1]) < 10) out.push(`letra de ${m[1]}px`);
  return out;
}

type Sent = { url: string; body: Record<string, string> };
let sent: Sent[] = [];
let nextResponse: () => Response = () => Response.json({ id: `prov-${nanoid(6)}`, status: "queued" }, { status: 202 });
setMailFetch(async (input, init) => {
  const url = String(input);
  sent.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
  return nextResponse();
});
const ok202 = () => Response.json({ id: `prov-${nanoid(6)}`, status: "queued" }, { status: 202 });

function linkFrom(html: string, path: string): string | null {
  const m = html.match(new RegExp(`href="([^"]*${path.replace(/[/?]/g, "\\$&")}[^"]*)"`));
  return m ? m[1].replace(/&amp;/g, "&") : null;
}

async function main() {
  process.env.APP_URL = BASE;
  process.env.CORREO_API_URL ||= "http://servicio-simulado";
  process.env.CORREO_API_KEY ||= "clave-simulada";

  // ── 1. Armado de los 10 correos ───────────────────────────────────────────
  console.log("\n— Armado de los correos (reglas del servicio)");
  const all = {
    bienvenida: M.bienvenida({ fullName: "<b>Laura</b> Pérez", email: "laura@club.mx", role: "student", url: `${BASE}/crear-contrasena?t=abc` }),
    bienvenidaStaff: M.bienvenida({ fullName: "Ana Maestra", email: "ana@club.mx", role: "teacher", url: `${BASE}/crear-contrasena?t=abc` }),
    restablecer: M.restablecer({ fullName: "Laura", email: "l@club.mx", url: `${BASE}/restablecer?t=x`, minutes: 60 }),
    restablecerAdmin: M.restablecer({ fullName: "Laura", email: "l@club.mx", url: `${BASE}/restablecer?t=x`, minutes: 1440, requestedBy: "Ana" }),
    cambioPass: M.cambioCuenta({ fullName: "Laura", what: "password", when: "4 de octubre de 2026, 9:41", account: "l@club.mx", recoverUrl: `${BASE}/recuperar` }),
    cambioMail: M.cambioCuenta({ fullName: "Laura", what: "email", when: "hoy", account: "a@club.mx", newEmail: "b@club.mx", recoverUrl: BASE }),
    inscripcion: M.inscripcion({
      fullName: "Laura",
      email: "l@club.mx",
      courses: [
        { title: "Inducción", teacher: "Ana", lessons: 5, validity: "12 meses", url: `${BASE}/courses/1` },
        { title: "Seguridad", teacher: "Ana", lessons: 1, validity: null, url: `${BASE}/courses/2` },
      ],
      dashboardUrl: `${BASE}/dashboard`,
    }),
    certificado: M.certificado({ fullName: "Laura", course: "Inducción", folio: "CERT-1", issued: "hoy", validUntil: null, courseUrl: `${BASE}/courses/1`, verifyUrl: `${BASE}/verify/CERT-1` }),
    vencimiento: M.vencimiento({ fullName: "Laura", course: "Inducción", folio: "CERT-1", issued: "ayer", expires: "mañana", daysLeft: 1, courseUrl: `${BASE}/courses/1` }),
    pendientes: M.pendientes({
      fullName: "Laura",
      items: [
        { kind: "exam", title: "Examen final", course: "Inducción", when: "Cierra hoy, 18:00", url: `${BASE}/courses/1/items/9` },
        { kind: "returned", title: "Tarea 1", course: "Inducción", when: "Devuelta", detail: "Falta la firma", url: `${BASE}/courses/1/items/8` },
      ],
      dashboardUrl: `${BASE}/dashboard`,
    }),
    resumen: M.resumenMaestro({
      fullName: "Ana",
      toGrade: [{ course: "Inducción", detail: "2 exámenes" }],
      toGradeTotal: 2,
      finished: { total: 1, text: "1 alumno terminó: Inducción (1).", url: `${BASE}/teach/dashboard` },
      expiring: { total: 3, text: "3 certificados vencen." },
      urls: { grading: `${BASE}/teach/grading`, renewals: `${BASE}/teach/renewals`, dashboard: `${BASE}/teach/dashboard` },
    }),
    aviso: M.aviso({ title: "Cambio de horario", message: "Mañana\nla clase es a las 9", from: "Ana", course: "Inducción", courseUrl: `${BASE}/courses/1` }),
    prueba: M.prueba({ fullName: "Abel", url: BASE }),
  };
  for (const [name, mail] of Object.entries(all)) {
    const problems = htmlProblems(mail.html);
    check(`${name}: HTML permitido`, problems.length === 0, problems.join(", "));
    check(`${name}: asunto y texto`, mail.subject.length > 5 && mail.text.length > 40);
    const hrefs = [...mail.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    check(`${name}: enlaces solo a la IP del servidor`, hrefs.length > 0 && hrefs.every((h) => h.startsWith(`${BASE}`)), hrefs.join(" "));
    check(`${name}: pie aparte con <!--pie-->`, mail.html.includes("<!--pie-->") && !mail.html.split("<!--pie-->")[1].includes("<"));
  }
  check("se escapa el HTML de los datos", !all.bienvenida.html.includes("<b>Laura") && all.bienvenida.html.includes("&lt;b&gt;Laura"));
  check("bienvenida dice que el enlace no caduca", all.bienvenida.text.includes("no caduca"));
  check("restablecer por un instructor menciona quién y 24 horas", all.restablecerAdmin.text.includes("Ana") && all.restablecerAdmin.text.includes("24 horas"));
  check("inscripción de 2 cursos en un correo", all.inscripcion.subject.includes("2 cursos") && all.inscripcion.text.includes("Seguridad"));
  check("aviso respeta saltos de línea", all.aviso.html.includes("white-space:pre-line"));
  check("dirección de prueba detectada", isTestAddress("a@empresa.local") && isTestAddress("x@example.com") && !isTestAddress("a@yucatangolf.com"));

  // ── 2. Cliente de la API ──────────────────────────────────────────────────
  console.log("\n— Cliente de la API (respuestas simuladas)");
  const payload = { to: "a@b.mx", subject: "s", html: "<p>x</p>", text: "x" };
  sent = [];
  nextResponse = ok202;
  const r1 = await sendMail({ ...payload, idempotencyKey: "k1" });
  check("202 devuelve id", r1.id.startsWith("prov-"));
  check("manda a /v1/send con la llave de idempotencia", sent[0]?.url.endsWith("/v1/send") && sent[0]?.body.idempotencyKey === "k1");
  const errorOf = async (res: () => Response) => {
    nextResponse = res;
    try {
      await sendMail(payload);
      return null;
    } catch (e) {
      return e as MailError;
    }
  };
  nextResponse = () => Response.json({ error: { code: "idempotencia", message: "ya", details: { id: "orig-1" } } }, { status: 409 });
  check("409 idempotencia cuenta como enviado", (await sendMail(payload)).id === "orig-1");
  const e429 = await errorOf(() => new Response(JSON.stringify({ error: { code: "cuota_excedida", message: "x" } }), { status: 429, headers: { "Retry-After": "42" } }));
  check("429 → esperar Retry-After", e429?.action === "wait" && e429.retryAfterSec === 42);
  const e500 = await errorOf(() => new Response("boom", { status: 503 }));
  check("5xx → reintentar", e500?.action === "retry");
  const e400 = await errorOf(() => Response.json({ error: { code: "enlace_no_permitido", message: "no" } }, { status: 400 }));
  check("400 → no reintentar", e400?.action === "fatal" && e400.code === "enlace_no_permitido");
  const eNet = await errorOf(() => {
    throw new TypeError("fetch failed");
  });
  check("sin conexión → reintentar", eNet?.action === "retry");
  nextResponse = ok202;

  // ── 3. Bandeja de salida y enlaces ────────────────────────────────────────
  console.log("\n— Bandeja de salida, bienvenida y enlaces de un solo uso");
  const mkUser = (role: "student" | "teacher", name: string) => {
    const id = nanoid();
    db.insert(users).values({ id, email: `${P}-${name}@${DOMAIN}`, passwordHash: "x", fullName: `${name} Prueba`, role }).run();
    return id;
  };
  const ana = mkUser("teacher", "ana");
  const laura = mkUser("student", "laura");

  const q = queueMail({ kind: "bienvenida", userId: laura });
  check("bienvenida encolada", q?.status === "pendiente");
  sent = [];
  resetMailPause();
  await sendNextMail();
  const row = db.select().from(emailLog).where(eq(emailLog.id, q!.id)).get()!;
  check("bienvenida enviada", row.status === "enviado" && !!row.providerId, `${row.status} ${row.error ?? ""}`);
  const invite = linkFrom(sent[0]?.body.html ?? "", "/crear-contrasena?t=");
  check("lleva enlace a /crear-contrasena en la IP", !!invite && invite.startsWith(`${BASE}/crear-contrasena?t=`), invite ?? "");
  check("sin caducidad para el servicio en la bienvenida", sent[0]?.body.expiresInMinutes === undefined);
  const token1 = new URL(invite!).searchParams.get("t")!;
  const c1 = checkToken(token1);
  check("enlace válido, de invitación", c1.ok && c1.purpose === "invite");
  check("mismo correo reintentado = mismo enlace", tokenFor(q!.id, "invite") === token1);
  check("el token no se guarda en claro", !JSON.stringify(db.select().from(emailLog).where(eq(emailLog.id, q!.id)).get()).includes(token1));

  // Reenviar acceso: nunca entró → otra bienvenida; la anterior deja de servir
  const again = queueAccessMail(laura, "Ana Prueba");
  check("reenviar a quien no ha entrado = bienvenida", again?.mode === "bienvenida");
  sent = [];
  await sendNextMail();
  const token2 = new URL(linkFrom(sent[0]?.body.html ?? "", "/crear-contrasena?t=")!).searchParams.get("t")!;
  check("el enlace anterior queda anulado", !checkToken(token1).ok && checkToken(token2).ok);
  const c2 = checkToken(token2);
  check("gastar el enlace", c2.ok && consumeToken(c2.id, c2.userId));
  check("no se gasta dos veces", c2.ok && !consumeToken(c2.id, c2.userId));
  check("enlace usado se reporta como usado", (() => {
    const c = checkToken(token2);
    return !c.ok && c.reason === "usado";
  })());

  // Ya entró → enlace de restablecer de 24 h
  db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, laura)).run();
  const reset = queueAccessMail(laura, "Ana Prueba");
  check("reenviar a quien ya entraba = restablecer", reset?.mode === "restablecer");
  sent = [];
  await sendNextMail();
  check("restablecer lleva caducidad al servicio", Number(sent[0]?.body.expiresInMinutes) > 60 * 23, String(sent[0]?.body.expiresInMinutes));
  check("restablecer dice quién lo pidió", (sent[0]?.body.text ?? "").includes("Ana Prueba"));

  // Autoservicio: freno de 5 minutos
  const before = db.select().from(emailLog).where(and(eq(emailLog.userId, laura), eq(emailLog.kind, "restablecer"))).all().length;
  requestPasswordReset(`${P}-laura@${DOMAIN}`);
  requestPasswordReset(`${P}-laura@${DOMAIN}`);
  requestPasswordReset("nadie@correo-smoke.mx");
  const after = db.select().from(emailLog).where(and(eq(emailLog.userId, laura), eq(emailLog.kind, "restablecer"))).all().length;
  check("«olvidé mi contraseña» con freno (solo 0 o 1 nuevo)", after - before <= 1, `${after - before}`);
  db.delete(emailLog).where(and(eq(emailLog.userId, laura), eq(emailLog.status, "pendiente"))).run();

  // Reset atrasado: ya no sale
  const late = queueMail({ kind: "restablecer", userId: laura, payload: { minutes: 60 } })!;
  db.update(emailLog).set({ createdAt: new Date(Date.now() - 2 * 3600_000) }).where(eq(emailLog.id, late.id)).run();
  await sendNextMail();
  check("restablecer atrasado se omite", db.select().from(emailLog).where(eq(emailLog.id, late.id)).get()?.status === "omitido");

  console.log("\n— Reintentos, límites y errores");
  const r429 = queueMail({ kind: "prueba", userId: laura })!;
  nextResponse = () => new Response("{}", { status: 429, headers: { "Retry-After": "30" } });
  await sendNextMail();
  const after429 = db.select().from(emailLog).where(eq(emailLog.id, r429.id)).get()!;
  check("429: sigue en cola con espera", after429.status === "pendiente" && !!after429.runAfter && after429.runAfter.getTime() > Date.now());
  check("429: el carril se pausa", (await sendNextMail()) === false);
  resetMailPause();
  nextResponse = () => new Response("caído", { status: 502 });
  await sendNextMail(Date.now() + 31_000);
  const after502 = db.select().from(emailLog).where(eq(emailLog.id, r429.id)).get()!;
  check("5xx: reintento programado", after502.status === "pendiente" && after502.attempts === 1);
  nextResponse = () => Response.json({ error: { code: "enlace_no_permitido", message: "no" } }, { status: 400 });
  resetMailPause();
  await sendNextMail(Date.now() + 5 * 60_000);
  const after400 = db.select().from(emailLog).where(eq(emailLog.id, r429.id)).get()!;
  check("400: queda como fallido con el motivo", after400.status === "fallido" && (after400.error ?? "").includes("enlace_no_permitido"));
  nextResponse = ok202;

  console.log("\n— Preferencias, duplicados y direcciones de prueba");
  db.update(users).set({ mailExpiry: false }).where(eq(users.id, laura)).run();
  check("aviso apagado en Ajustes no se encola", queueMail({ kind: "vencimiento", userId: laura, ref: "x", once: true }) === null);
  check("los de cuenta no se pueden apagar", queueMail({ kind: "cambio_cuenta", userId: laura, payload: { what: "password" } }) !== null);
  db.update(users).set({ mailExpiry: true }).where(eq(users.id, laura)).run();
  const once1 = queueMail({ kind: "certificado", userId: laura, ref: "cert-x", once: true });
  const once2 = queueMail({ kind: "certificado", userId: laura, ref: "cert-x", once: true });
  check("«una sola vez» no repite", once1 !== null && once2 === null);
  const demoId = nanoid();
  db.insert(users).values({ id: demoId, email: `${P}@empresa.local`, passwordHash: "x", fullName: "Demo", role: "student" }).run();
  check("dirección de prueba queda como omitido", queueMail({ kind: "bienvenida", userId: demoId })?.status === "omitido");
  db.update(users).set({ active: false }).where(eq(users.id, demoId)).run();
  check("cuenta desactivada no recibe nada", queueMail({ kind: "prueba", userId: demoId }) === null);
  db.delete(emailLog).where(and(eq(emailLog.userId, laura), eq(emailLog.status, "pendiente"))).run();

  console.log("\n— Inscripción: varios cursos en un solo correo");
  const c1c = courses.createCourse({ ownerId: ana, title: `${P} Inducción` });
  const c2c = courses.createCourse({ ownerId: ana, title: `${P} Seguridad` });
  const c3c = courses.createCourse({ ownerId: ana, title: `${P} Borrador` });
  for (const c of [c1c, c2c]) {
    tree.createItem({ courseId: c.id, parentId: null, kind: "text", title: "Lección" });
    db.update(coursesTable).set({ status: "published" }).where(eq(coursesTable.id, c.id)).run();
  }
  courses.enrollStudents(c1c.id, [laura], ana);
  courses.enrollStudents(c2c.id, [laura], ana);
  courses.enrollStudents(c3c.id, [laura], ana);
  const insc = db.select().from(emailLog).where(and(eq(emailLog.userId, laura), eq(emailLog.kind, "inscripcion"))).all();
  check("un solo correo para 3 inscripciones seguidas", insc.length === 1 && (insc[0].payload as { enrollmentIds: string[] }).enrollmentIds.length === 3);
  check("espera 2 minutos para juntar", (await sendNextMail()) === false || db.select().from(emailLog).where(eq(emailLog.id, insc[0].id)).get()?.status === "pendiente");
  sent = [];
  await sendNextMail(Date.now() + 3 * 60_000);
  const inscSent = sent[0]?.body;
  check("sale con los 2 cursos publicados", !!inscSent && inscSent.subject.includes("2 cursos") && inscSent.text.includes("Seguridad"), inscSent?.subject);
  check("el borrador espera en otro correo", db.select().from(emailLog).where(and(eq(emailLog.userId, laura), eq(emailLog.kind, "inscripcion"), eq(emailLog.status, "pendiente"))).all().length === 1);
  db.delete(emailLog).where(and(eq(emailLog.userId, laura), eq(emailLog.status, "pendiente"))).run();

  console.log("\n— Revisiones diarias");
  const { hour, date } = localNow(Date.parse("2026-10-04T14:30:00Z"));
  check("hora de Mérida (UTC-6)", hour === 8 && date === "2026-10-04", `${date} ${hour}`);
  const nowRef = Date.parse("2026-10-04T15:00:00Z");
  check("«Cierra hoy»", whenLabel("Cierra", new Date(nowRef + 2 * 3600_000), nowRef).startsWith("Cierra hoy"));
  check("«Cierra mañana»", whenLabel("Cierra", new Date(nowRef + 24 * 3600_000), nowRef).startsWith("Cierra mañana"));

  // Certificado que vence en 10 días → un aviso
  const enr = db.select().from(enrollments).where(and(eq(enrollments.courseId, c1c.id), eq(enrollments.studentId, laura))).get()!;
  const certId = nanoid();
  db.insert(certificates)
    .values({
      id: certId,
      folio: `${P}-CERT`,
      enrollmentId: enr.id,
      studentId: laura,
      courseId: c1c.id,
      issuedAt: new Date(Date.now() - 355 * 86_400_000),
      expiresAt: new Date(Date.now() + 10 * 86_400_000),
      verificationHash: "x",
    })
    .run();
  runExpiryMails();
  runExpiryMails();
  const venc = db.select().from(emailLog).where(and(eq(emailLog.userId, laura), eq(emailLog.kind, "vencimiento"))).all();
  check("vencimiento: un solo aviso por certificado", venc.length === 1);
  sent = [];
  await sendNextMail();
  check("vencimiento enviado con el folio", (sent[0]?.body.text ?? "").includes(`${P}-CERT`));

  // Examen que cierra en 24 h sin aprobar → pendiente
  const ex = tree.createItem({ courseId: c1c.id, parentId: null, kind: "exam", title: "Examen final" });
  db.update(exams).set({ closesAt: new Date(Date.now() + 24 * 3600_000) }).where(eq(exams.itemId, ex.id)).run();
  const pend = collectPending().get(laura) ?? [];
  check("pendientes: examen que cierra pronto", pend.some((p) => p.kind === "exam" && p.title === "Examen final"));
  check("resumen del maestro se calcula", (() => {
    try {
      teacherDigest(ana);
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  })());

  // ── Limpieza ──────────────────────────────────────────────────────────────
  for (const c of [c1c, c2c, c3c]) {
    db.delete(certificates).where(eq(certificates.courseId, c.id)).run();
    courses.deleteCourse(c.id);
  }
  for (const u of db.select({ id: users.id }).from(users).where(like(users.email, `${P}%`)).all()) {
    db.delete(users).where(eq(users.id, u.id)).run();
  }

  console.log(failures === 0 ? "\nTodo bien." : `\n${failures} prueba(s) fallaron.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
