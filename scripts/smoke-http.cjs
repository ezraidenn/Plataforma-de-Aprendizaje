// Smoke HTTP: verifica que todas las páginas de Fase 1 rendericen con
// sesiones reales. Uso: node scripts/smoke-http.cjs
const Database = require("better-sqlite3");
const { createHash, randomBytes } = require("node:crypto");
const path = require("node:path");

const db = new Database(process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "data.db"));

function makeSession(email) {
  const user = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  const token = randomBytes(24).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  db.prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(
    hash,
    user.id,
    Date.now() + 3600_000,
    Date.now()
  );
  return token;
}

async function main() {
  const teacher = makeSession("maestro@empresa.local");
  const student = makeSession("estudiante@empresa.local"); // Laura: a medio curso
  const graduate = makeSession("maria.lopez@empresa.local"); // aprobó todo: sin candados
  const admin = makeSession("admin@empresa.local");

  // Curso demo hiperrealista (publicado); los cursos de prueba viejos están archivados
  const course = db
    .prepare("SELECT id FROM courses WHERE status = 'published' AND title LIKE 'Uso y Manejo%'")
    .get();
  const pick = (kind) =>
    db
      .prepare("SELECT id FROM course_items WHERE course_id = ? AND kind = ? ORDER BY position LIMIT 1")
      .get(course.id, kind);
  const textItem = pick("text");
  const docItem = pick("document");
  const examItem = pick("exam");
  const videoItem = pick("video");
  const assignmentItem = pick("assignment");
  const courseF3 = course;
  const template = db.prepare("SELECT id FROM certificate_templates LIMIT 1").get();
  const cert = db
    .prepare("SELECT folio, student_id FROM certificates WHERE revoked = 0 ORDER BY created_at DESC LIMIT 1")
    .get();
  // F8 (opcionales: dependen de los datos demo de seed-demo-cycles)
  const cohort = db.prepare("SELECT id FROM cohorts WHERE status = 'open' ORDER BY created_at LIMIT 1").get();
  const expiredCert = db
    .prepare("SELECT folio FROM certificates WHERE revoked = 0 AND expires_at < ? ORDER BY expires_at LIMIT 1")
    .get(Date.now());
  db.close();

  const checks = [
    ["/login", null],
    ["/teach/dashboard", teacher],
    ["/teach/courses", teacher],
    [`/teach/courses/${course.id}/content`, teacher],
    [`/teach/courses/${course.id}/students`, teacher],
    [`/teach/courses/${course.id}/settings`, teacher],
    [`/teach/courses/${course.id}/rules`, teacher],
    [`/teach/courses/${course.id}/items/${examItem.id}/edit`, teacher],
    ["/teach/students", teacher],
    ["/dashboard", student],
    [`/courses/${course.id}`, student],
    [`/courses/${course.id}/items/${textItem.id}`, student],
    [`/courses/${course.id}/items/${docItem.id}`, student],
    [`/courses/${course.id}/items/${examItem.id}`, graduate],
    [`/courses/${course.id}/items/${videoItem.id}`, graduate],
    // Fase 3
    ["/teach/grading", teacher],
    ["/teach/templates", teacher],
    [`/teach/templates/${template.id}`, teacher],
    [`/courses/${course.id}/items/${assignmentItem.id}`, graduate],
    [`/verify/${cert.folio}`, null], // pública, sin sesión
    ["/verify/FOLIO-INEXISTENTE", null],
    // Fase 4
    ["/teach/reports", teacher],
    [`/teach/reports?course=${courseF3.id}`, teacher],
    // F5: estadísticas y ZIP
    [`/teach/courses/${courseF3.id}/stats`, teacher],
    [`/api/certificates/zip?courseId=${courseF3.id}`, teacher],
    // Perfil del estudiante + portafolio
    [`/teach/students/${cert.student_id}`, teacher],
    [`/api/certificates/zip?studentId=${cert.student_id}`, teacher],
    [`/teach/courses?q=extintores`, teacher],
    // F8: vigencia, ciclos, grupos y papelera
    ["/teach/groups", teacher],
    ["/teach/groups?estado=closed", teacher],
    ["/teach/renewals", teacher],
    ["/teach/renewals?tab=expiring", teacher],
    ["/teach/renewals?tab=expired", teacher],
    // Ayuda visual (catálogo de escenas)
    ["/teach/ayuda", teacher],
    [`/teach/courses/${course.id}/students?grupo=all`, teacher],
    [`/teach/courses/${course.id}/students?grupo=none`, teacher],
    ...(cohort
      ? [
          [`/teach/courses/${course.id}/students?grupo=${cohort.id}`, teacher],
          [`/teach/reports?course=${courseF3.id}&grupo=${cohort.id}`, teacher],
          [`/teach/courses/${courseF3.id}/stats?grupo=${cohort.id}`, teacher],
        ]
      : []),
    ...(expiredCert ? [[`/verify/${expiredCert.folio}`, null]] : []),
    ["/admin/users", admin],
    ["/admin/courses", admin],
    ["/admin/settings", admin],
    // Cuenta: /ajustes y /guia para los 3 roles
    ["/ajustes", teacher],
    ["/ajustes", student],
    ["/ajustes", admin],
    ["/guia", teacher],
    ["/guia", student],
    ["/guia", admin],
    // Cruce de roles: estudiante en zona de maestro y maestro en admin → redirigen
    ["/teach/dashboard", student],
    ["/admin/users", teacher],
  ];

  let failures = 0;
  for (const [route, token] of checks) {
    const res = await fetch(`${process.env.BASE_URL ?? "http://localhost:3000"}${route}`, {
      headers: token ? { cookie: `session=${token}` } : {},
      redirect: "manual",
    });
    const loc = res.headers.get("location") ?? "";
    const expectRedirect =
      (route === "/teach/dashboard" && token === student) ||
      (route === "/admin/users" && token === teacher);
    const ok = expectRedirect ? res.status >= 300 && res.status < 400 : res.status === 200;
    if (!ok) failures++;
    console.log(
      `${ok ? "✓" : "✗"} ${res.status} ${route}${loc ? " -> " + loc : ""}${expectRedirect ? " (redirect esperado)" : ""}`
    );
  }

  console.log(failures === 0 ? "\n✅ HTTP OK" : `\n❌ ${failures} fallas`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
