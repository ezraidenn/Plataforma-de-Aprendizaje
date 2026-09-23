/**
 * Contexto de vista del admin, alumnos por maestro y pool general, contra la base real.
 * Crea sus datos con el prefijo «zscope» y los borra al terminar; los conteos
 * se miden SOLO sobre esos datos (búsqueda «zscope»), así que los datos demo
 * no afectan.
 *
 * Uso: pnpm smoke:scope
 */
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { NextRequest } from "next/server";
import { middleware } from "../src/middleware";
import { db } from "../src/server/db";
import {
  assignmentAttachments,
  assignmentSubmissions,
  auditLog,
  certificates,
  certificateTemplates,
  cohorts,
  courseItems,
  courses as coursesTable,
  enrollments,
  exams,
  files,
  itemAssignments,
  itemDocuments,
  itemResourceFiles,
  jobs,
  questions,
  submissionFiles,
  users,
} from "../src/server/db/schema";
import { teacherCanAccessFile } from "../src/server/services/file-access";
import { addResourceFile, resourceItemForFile } from "../src/server/services/resources";
import { addAssignmentAttachment, attachmentItemForFile } from "../src/server/services/assignments";
import { attachDocumentFile } from "../src/server/services/documents";
import { inlineAllowed } from "../src/lib/inline-mime";
import { resolveUploadMime } from "../src/lib/upload-types";
import { isDocumentLoad, stripCookie, titleWithOwner, initialsOf, contextWords, VIEW_ALL } from "../src/lib/view-context";
import { actingOwnerId, fullScope, ownScope, resolveViewScope } from "../src/server/auth/view-scope";
import { isStudentInPool, isStudentVisible, studentAccountPermissions } from "../src/server/services/student-scope";
import { createStudent, enrollStudents, ExistingStudentError, listStudents, listTeacherCourses } from "../src/server/services/courses";
import { getStudentProfile } from "../src/server/services/student-profile";
import { gradingQueue } from "../src/server/services/grading";
import { renewalCounts } from "../src/server/services/renewals";
import { listCohorts, cohortOptionsForUser } from "../src/server/services/cohorts";
import {
  listTemplates,
  listTeacherCertificates,
  listCertificateCourses,
  backfillCertificateSnapshots,
  verificationHash,
  verifyCertificate,
  createTemplate,
  listGeneralTemplates,
  listAssignableTemplates,
  canAssignTemplate,
  templateUsage,
} from "../src/server/services/certificates";
import { listViewContextOptions, viewContextInfo } from "../src/server/services/view-context";
import { onboardingSteps, type OnboardingFacts } from "../src/lib/onboarding";
import { onboardingFacts } from "../src/server/services/onboarding";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  }
}

const H = (h: Record<string, string>) => new Headers(h);

const P = "zscope";

type Fixture = {
  admin: { id: string; role: "admin" };
  a: { id: string; role: "teacher" };
  b: { id: string; role: "teacher" };
  students: string[]; // 20: 0..19. Los 10 últimos (10..19) están también con B
  coursesA: string[];
  coursesB: string[];
  courseAdmin: string;
};

function cleanup() {
  const ids = db.select({ id: users.id }).from(users).where(like(users.email, `${P}-%`)).all().map((r) => r.id);
  if (ids.length === 0) return;
  const courseIds = db.select({ id: coursesTable.id }).from(coursesTable).where(inArray(coursesTable.ownerId, ids)).all().map((r) => r.id);
  if (courseIds.length) db.delete(certificates).where(inArray(certificates.courseId, courseIds)).run();
  // Enganchar un documento encola trabajos por ítem (conversión, reacomodo)
  const itemIds = courseIds.length
    ? db.select({ id: courseItems.id }).from(courseItems).where(inArray(courseItems.courseId, courseIds)).all().map((r) => r.id)
    : [];
  if (itemIds.length) db.delete(jobs).where(inArray(sql`json_extract(${jobs.payload}, '$.itemId')`, itemIds)).run();
  db.delete(coursesTable).where(inArray(coursesTable.ownerId, ids)).run(); // cascada: matrículas, grupos, ítems
  // Plantillas y archivos de prueba: después de cursos y certificados, que los referencian
  db.delete(certificateTemplates).where(inArray(certificateTemplates.ownerId, ids)).run();
  const fileIds = db.select({ id: files.id }).from(files).where(inArray(files.uploadedBy, ids)).all().map((r) => r.id);
  if (fileIds.length) {
    // Enlazar un archivo encola su reacomodo en disco (inofensivo: no existe en disco)
    db.delete(jobs).where(inArray(sql`json_extract(${jobs.payload}, '$.fileId')`, fileIds)).run();
    db.delete(files).where(inArray(files.id, fileIds)).run();
  }
  db.delete(enrollments).where(inArray(enrollments.studentId, ids)).run();
  db.delete(auditLog).where(inArray(auditLog.userId, ids)).run();
  db.delete(users).where(inArray(users.id, ids)).run();
}

function addUser(key: string, name: string, role: "admin" | "teacher" | "student", createdBy: string | null = null) {
  const id = nanoid();
  db.insert(users).values({ id, email: `${P}-${key}@test.local`, passwordHash: "x", fullName: `${P} ${name}`, role, createdBy }).run();
  return id;
}

function addCourse(ownerId: string, title: string) {
  const id = nanoid();
  db.insert(coursesTable).values({ id, title: `${P} ${title}`, ownerId }).run();
  return id;
}

function enroll(courseId: string, studentId: string, by: string) {
  db.insert(enrollments).values({ id: nanoid(), courseId, studentId, enrolledBy: by, cycle: 1 }).run();
}

function setup(): Fixture {
  cleanup();
  const admin = addUser("admin", "Admin", "admin");
  const a = addUser("a", "Maestro A", "teacher");
  const b = addUser("b", "Maestro B", "teacher");
  const students = Array.from({ length: 20 }, (_, i) =>
    addUser(`s${String(i).padStart(2, "0")}`, `Alumno ${String(i).padStart(2, "0")}`, "student", a)
  );
  const coursesA = [1, 2, 3, 4, 5].map((n) => addCourse(a, `Curso A${n}`));
  const coursesB = [1, 2].map((n) => addCourse(b, `Curso B${n}`));
  const courseAdmin = addCourse(admin, "Curso del admin");
  for (const s of students) enroll(coursesA[0], s, a);
  for (const s of students.slice(10)) enroll(coursesB[0], s, b);
  return {
    admin: { id: admin, role: "admin" },
    a: { id: a, role: "teacher" },
    b: { id: b, role: "teacher" },
    students,
    coursesA,
    coursesB,
    courseAdmin,
  };
}

function scopeSection(f: Fixture) {
  console.log("\n— Alcance de la vista");
  check("Maestro: siempre lo suyo", JSON.stringify(resolveViewScope(f.a, VIEW_ALL)) === JSON.stringify(ownScope(f.a)));
  check("Admin sin cookie: Mi contenido", resolveViewScope(f.admin, undefined).kind === "own");
  check("Admin «all»: General", resolveViewScope(f.admin, VIEW_ALL).kind === "all");
  const asA = resolveViewScope(f.admin, f.a.id);
  check("Admin «Ver como A»", asA.kind === "teacher" && asA.ownerId === f.a.id, asA);
  check("Cookie con id de alumno: cae a Mi contenido", resolveViewScope(f.admin, f.students[0]).kind === "own");
  check("Cookie con id inexistente: cae a Mi contenido", resolveViewScope(f.admin, "nope").kind === "own");
  check("fullScope admin = General", fullScope(f.admin).kind === "all");
  check("fullScope maestro = lo suyo", fullScope(f.b).kind === "own");
  check("Crear viendo como A queda a nombre de A", actingOwnerId(asA, f.admin) === f.a.id);
  check("Crear en General queda a nombre del admin", actingOwnerId({ kind: "all" }, f.admin) === f.admin.id);

  // Seguridad de la cookie: un maestro no se mueve de lado y un admin/alumno no es «maestro»
  check("Maestro con id de otro maestro: sigue en lo suyo", JSON.stringify(resolveViewScope(f.a, f.b.id)) === JSON.stringify(ownScope(f.a)));
  check("Cookie con id de un admin: cae a Mi contenido", resolveViewScope(f.admin, f.admin.id).kind === "own");
  // Un maestro inactivo sigue resolviendo: sus cursos no deben quedar fuera de la vista
  db.update(users).set({ active: false }).where(eq(users.id, f.b.id)).run();
  const asB = resolveViewScope(f.admin, f.b.id);
  check("Maestro inactivo sigue resolviendo", asB.kind === "teacher" && asB.ownerId === f.b.id, asB);
  db.update(users).set({ active: true }).where(eq(users.id, f.b.id)).run();
}

function pure() {
  console.log("\n— Carga completa vs. navegación interna");
  check("F5 / Ctrl+Shift+R (documento)", isDocumentLoad("GET", H({ "sec-fetch-dest": "document", accept: "text/html" })));
  check("Navegación interna (RSC) conserva", !isDocumentLoad("GET", H({ rsc: "1", "sec-fetch-dest": "empty" })));
  check("Prefetch conserva", !isDocumentLoad("GET", H({ rsc: "1", "next-router-prefetch": "1" })));
  check("Acción de servidor conserva", !isDocumentLoad("POST", H({ "next-action": "abc", accept: "text/x-component" })));
  check("Sin Sec-Fetch-Dest: decide por Accept", isDocumentLoad("GET", H({ accept: "text/html,application/xhtml+xml" })));
  check("Fetch de datos no es documento", !isDocumentLoad("GET", H({ "sec-fetch-dest": "empty", accept: "*/*" })));

  // Lo que el middleware recibe de verdad en la LAN por HTTP (sin Sec-Fetch-*
  // y sin RSC, que Next quita antes del middleware)
  check("LAN: navegación interna (Accept */*) conserva", !isDocumentLoad("GET", H({ accept: "*/*" })));
  check(
    "LAN: F5 con el Accept real de Chrome",
    isDocumentLoad("GET", H({ accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7" }))
  );

  console.log("\n— Utilidades");
  check("stripCookie quita solo «vista»", stripCookie("session=abc; vista=all; x=1", "vista") === "session=abc; x=1");
  check("stripCookie sin la cookie no cambia", stripCookie("session=abc", "vista") === "session=abc");
  check("titleWithOwner en General", titleWithOwner("NOM-035", "Maestro A", true) === "NOM-035 · Maestro A");
  check("titleWithOwner fuera de General", titleWithOwner("NOM-035", "Maestro A", false) === "NOM-035");
  check("initialsOf", initialsOf("Raúl Cetina Pool") === "RC" && initialsOf("Raúl") === "R" && initialsOf("  ") === "?");
  check("contextWords", contextWords("own").heading === "Mis cursos" && contextWords("teacher", "Ana").courses === "los cursos de Ana" && contextWords("all").heading === "Todos los cursos");

  console.log("\n— Archivos: qué se abre en el navegador");
  check("inline: PDF, imágenes, video y audio", ["application/pdf", "image/png", "image/jpeg", "image/webp", "video/mp4", "audio/mpeg"].every((m) => inlineAllowed(m)));
  check("inline: sin importar parámetros ni mayúsculas", inlineAllowed("Application/PDF; charset=binary"));
  check(
    "descarga: HTML, SVG, texto y desconocidos",
    ["text/html", "image/svg+xml", "application/xhtml+xml", "text/plain", "application/octet-stream", ""].every((m) => !inlineAllowed(m))
  );

  console.log("\n— Archivos: qué tipo se admite al subir");
  const mimeOf = (kind: string, name: string, declared: string | null) => {
    const r = resolveUploadMime(kind, name, declared);
    return r.ok ? r.mime : `error: ${r.error}`;
  };
  check("Portada PNG: se admite", mimeOf("cover", "foto.png", "image/png") === "image/png");
  check("Portada con HTML disfrazado: se rechaza", mimeOf("cover", "x.png", "text/html").startsWith("error"));
  check("Portada SVG: se rechaza", mimeOf("cover", "logo.svg", "image/svg+xml").startsWith("error"));
  check("Logo con alias image/jpg: se guarda como image/jpeg", mimeOf("branding", "logo.jpg", "image/jpg") === "image/jpeg");
  check(
    "PPTX sin tipo del navegador: se deduce por extensión",
    mimeOf("course_source", "clase.PPTX", "") === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  );
  check("Documento .docx como fuente de curso: se rechaza", mimeOf("course_source", "notas.docx", "application/octet-stream").startsWith("error"));
  check("Fondo de plantilla PDF: se admite", mimeOf("template_bg", "fondo.pdf", "application/pdf; charset=binary") === "application/pdf");
  check("Imagen pegada GIF: se admite", mimeOf("editor_image", "imagen.png", "image/gif") === "image/gif");
  check("Entrega de cualquier tipo: se conserva", mimeOf("submission", "tarea.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document").startsWith("application/vnd.openxml"));
  check("Entrega con tipo inválido: queda como binario", mimeOf("submission", "x.bin", "no es un tipo") === "application/octet-stream");
  check("Recurso sin tipo pero .pdf: se deduce", mimeOf("resource", "guia.pdf", null) === "application/pdf");
}

function onboardingSection() {
  console.log("\n— Primeros pasos (regla pura)");
  const none: OnboardingFacts = { hasCourse: false, hasLesson: false, hasStudent: false, hasPublishedWithEnrollment: false, hasTemplate: false, latestCourseId: null };
  const r0 = onboardingSteps(none);
  check("0/5: siguiente es crear curso", r0.done === 0 && r0.total === 5 && r0.next?.key === "course" && r0.next.href === "/teach/dashboard?nuevo=1");
  const r2 = onboardingSteps({ ...none, hasCourse: true, hasLesson: true, latestCourseId: "c1" });
  check("2/5: siguiente es registrar alumnos", r2.done === 2 && r2.next?.key === "students" && r2.next.href === "/teach/students?nuevo=1");
  check("Destinos usan el curso reciente y llegan con la acción lista", r2.steps.find((s) => s.key === "template")?.href === "/teach/courses/c1/settings#diploma");
  check("Lección: abre el menú «Agregar»", r2.steps.find((s) => s.key === "lesson")?.href === "/teach/courses/c1/content?agregar=1");
  check("Matrícula: abre el diálogo de matricular", r2.steps.find((s) => s.key === "publish")?.href === "/teach/courses/c1/students?matricular=1");
  const f4: OnboardingFacts = { ...none, hasCourse: true, hasLesson: true, hasStudent: true, hasPublishedWithEnrollment: true, latestCourseId: "c1" };
  const r4 = onboardingSteps(f4);
  check("4/5: siguiente es diploma", r4.done === 4 && r4.next?.key === "template");
  check("Saltos: hecho el 5 sin el 3, siguiente es el 3", onboardingSteps({ ...none, hasCourse: true, hasLesson: true, hasTemplate: true, latestCourseId: "c1" }).next?.key === "students");
  const r5 = onboardingSteps({ ...f4, hasTemplate: true });
  check("5/5: sin siguiente", r5.done === 5 && r5.next === null);
  check("Sin curso, los pasos de curso apuntan a crear uno", r0.steps.find((s) => s.key === "lesson")?.href === "/teach/dashboard?nuevo=1");
}

function accountSection(f: Fixture) {
  console.log("\n— Alumnos por maestro y cuenta");
  const [s0, , , , , s5] = f.students;
  const s15 = f.students[15];
  check("A ve a su alumno exclusivo", isStudentVisible(ownScope(f.a), s5));
  check("B no ve a un alumno solo de A", !isStudentVisible(ownScope(f.b), s0));
  check("B ve a un alumno compartido", isStudentVisible(ownScope(f.b), s15));
  check("General ve a todos", isStudentVisible({ kind: "all" }, s0));

  const bOnS0 = studentAccountPermissions(f.b, s0);
  check("B no puede tocar la cuenta de un ajeno", !bOnS0.canResetPassword && !bOnS0.canActivate && !bOnS0.canDeactivate && !bOnS0.mine, bOnS0);
  const bOnS15 = studentAccountPermissions(f.b, s15);
  check("B reactiva a un compartido, pero no lo restablece ni desactiva", bOnS15.mine && !bOnS15.canResetPassword && bOnS15.canActivate && !bOnS15.canDeactivate, bOnS15);
  const aOnS5 = studentAccountPermissions(f.a, s5);
  check("A desactiva a su alumno exclusivo", aOnS5.canResetPassword && aOnS5.canDeactivate, aOnS5);
  check("A no desactiva a un compartido", !studentAccountPermissions(f.a, s15).canDeactivate);
  check("A no restablece a un compartido", !studentAccountPermissions(f.a, s15).canResetPassword);
  const adm = studentAccountPermissions(f.admin, s15);
  check("El admin puede todo", adm.canResetPassword && adm.canActivate && adm.canDeactivate && adm.mine);
  check("Un maestro nunca es «alumno visible»", !isStudentVisible({ kind: "all" }, f.a.id));

  // Creador cuyo alumno ya solo estudia con otro maestro: lo ve, no lo restablece ni desactiva
  const x = addUser("s-creado-b", "Alumno creado por B", "student", f.b.id);
  enroll(f.coursesA[0], x, f.a.id);
  const bOnX = studentAccountPermissions(f.b, x);
  check("Creador sin cursos del alumno: lo ve, pero no lo restablece ni desactiva", bOnX.mine && !bOnX.canResetPassword && !bOnX.canDeactivate, bOnX);
  db.delete(users).where(eq(users.id, x)).run(); // su matrícula cae en cascada

  // Aprobado con otro maestro también cuenta como compartido
  db.update(enrollments).set({ status: "completed" })
    .where(and(eq(enrollments.courseId, f.coursesB[0]), eq(enrollments.studentId, s15))).run();
  check("Aprobado con otro maestro cuenta como compartido", !studentAccountPermissions(f.a, s15).canDeactivate);
  db.update(enrollments).set({ status: "active" })
    .where(and(eq(enrollments.courseId, f.coursesB[0]), eq(enrollments.studentId, s15))).run();

  // Alta sin matrícula: visible para quien lo registró
  const loner = addUser("s-loner", "Alumno sin curso", "student", f.b.id);
  check("Alta de B sin cursos: B lo ve", isStudentVisible(ownScope(f.b), loner));
  check("Alta de B sin cursos: A no lo ve", !isStudentVisible(ownScope(f.a), loner));
  // Fuera: las secciones siguientes cuentan el ejemplo exacto (B = 10)
  db.delete(users).where(eq(users.id, loner)).run();

  // Baja de B: B lo conserva por historial y deja de ser compartido para A
  db.update(enrollments)
    .set({ status: "dropped", droppedFrom: "active", droppedAt: new Date(), droppedBy: f.b.id })
    .where(and(eq(enrollments.courseId, f.coursesB[0]), eq(enrollments.studentId, s15)))
    .run();
  check("Tras la baja, B lo sigue viendo (historial)", isStudentVisible(ownScope(f.b), s15));
  const aAfter = studentAccountPermissions(f.a, s15);
  check("Tras la baja de B, A ya puede restablecerlo y desactivarlo", aAfter.canResetPassword && aAfter.canDeactivate);
  db.update(enrollments)
    .set({ status: "active", droppedFrom: null, droppedAt: null, droppedBy: null })
    .where(and(eq(enrollments.courseId, f.coursesB[0]), eq(enrollments.studentId, s15)))
    .run();

  check("No se inscribe a un maestro como alumno", enrollStudents(f.coursesA[0], [f.b.id], f.a.id) === 0);
}

function coursesSection(f: Fixture) {
  console.log("\n— Cursos por contexto");
  const n = (scope: Parameters<typeof listTeacherCourses>[0]) => listTeacherCourses(scope, P).length;
  check("A: 5 cursos", n(ownScope(f.a)) === 5, n(ownScope(f.a)));
  check("B: 2 cursos", n(ownScope(f.b)) === 2, n(ownScope(f.b)));
  check("Admin en Mi contenido: 1", n(ownScope(f.admin)) === 1, n(ownScope(f.admin)));
  check("Admin viendo como A: 5", n({ kind: "teacher", ownerId: f.a.id }) === 5);
  check("General: 8", n({ kind: "all" }) === 8, n({ kind: "all" }));
  const row = listTeacherCourses({ kind: "all" }, P).find((r) => r.course.id === f.coursesB[0]);
  check("Trae el nombre del dueño", row?.ownerName === `${P} Maestro B`, row?.ownerName);
  check("Conteo de inscritos con el join", row?.enrolled === 10, row?.enrolled);
  check("Sin búsqueda: A 5", listTeacherCourses(ownScope(f.a)).length === 5);
}

function studentsSection(f: Fixture) {
  console.log("\n— Alumnos por contexto (tu ejemplo)");
  const total = (scope: Parameters<typeof listStudents>[0]) => listStudents(scope, { search: P, pageSize: 100 }).total;
  check("A ve 20", total(ownScope(f.a)) === 20, total(ownScope(f.a)));
  check("B ve 10", total(ownScope(f.b)) === 10, total(ownScope(f.b)));
  check("General ve 20 (sin repetir los 10 en común)", total({ kind: "all" }) === 20, total({ kind: "all" }));
  check("Admin en Mi contenido: 0", total(ownScope(f.admin)) === 0);

  const rowsB = listStudents(ownScope(f.b), { search: P, pageSize: 100 }).rows;
  const r15 = rowsB.find((r) => r.id === f.students[15]);
  check("B: «Cursos» cuenta solo los suyos", r15?.courseCount === 1, r15?.courseCount);
  check("B: el compartido viene marcado", Boolean(r15?.sharedElsewhere), r15);
  const rowsA = listStudents(ownScope(f.a), { search: P, pageSize: 100 }).rows;
  check("A: su exclusivo no está marcado", !rowsA.find((r) => r.id === f.students[5])?.sharedElsewhere);

  console.log("\n— Perfil del alumno");
  // Pool: B abre la ficha de un alumno solo de A, pero no ve nada de los cursos de A
  const p0 = getStudentProfile(f.students[0], ownScope(f.b));
  check(
    "B abre a un alumno solo de A, sin sus cursos ni certificados",
    p0 !== null && p0.courses.length === 0 && p0.certificates.length === 0 && p0.totals.totalSeconds === 0 && p0.outsideCount > 0,
    p0
  );
  check("La ficha no abre a un maestro", getStudentProfile(f.a.id, ownScope(f.b)) === null);
  const p = getStudentProfile(f.students[15], ownScope(f.b))!;
  check("B ve solo sus cursos del alumno", p.courses.length === 1 && p.courses[0].courseId === f.coursesB[0], p.courses);
  check("Cuenta los cursos fuera de la vista", p.outsideCount === 1, p.outsideCount);
  const asA = { kind: "teacher", ownerId: f.a.id } as const;
  const adminAsA = getStudentProfile(f.students[15], asA)!;
  check("Admin viendo como A: solo cursos de A", adminAsA.courses.every((c) => f.coursesA.includes(c.courseId)));
  check("Admin puede abrir a alguien fuera del contexto", getStudentProfile(f.students[0], ownScope(f.admin)) !== null);
  check("General: todos sus cursos", getStudentProfile(f.students[15], { kind: "all" })!.courses.length === 2);

  const allRows = listStudents({ kind: "all" }, { search: P, pageSize: 100 }).rows;
  check("General: «Cursos» de un compartido = 2", allRows.find((r) => r.id === f.students[15])?.courseCount === 2);
  // Visible solo por haberlo dado de alta: sin cursos en la vista, pero con uno fuera
  const y = addUser("s-solo-alta", "Alumno de alta de B", "student", f.b.id);
  enroll(f.coursesA[1], y, f.a.id);
  const py = getStudentProfile(y, { kind: "teacher", ownerId: f.b.id })!;
  check("Solo por alta: sin cursos en la vista, 1 fuera", py.courses.length === 0 && py.outsideCount === 1, py);
  db.delete(users).where(eq(users.id, y)).run(); // su matrícula cae en cascada
}

async function poolSection(f: Fixture) {
  console.log("\n— Pool general de alumnos");
  const [s0] = f.students;
  const s15 = f.students[15];
  const pool = (scope: Parameters<typeof listStudents>[0]) =>
    listStudents(scope, { search: P, pageSize: 100, pool: true });
  check("B ve en el pool a los 20 (A los registró todos)", pool(ownScope(f.b)).total === 20, pool(ownScope(f.b)).total);
  check("A también ve 20 en el pool", pool(ownScope(f.a)).total === 20);
  check("El pool no trae maestros ni admins", pool({ kind: "all" }).rows.every((r) => f.students.includes(r.id)));
  const rowsB = pool(ownScope(f.b)).rows;
  const r0 = rowsB.find((r) => r.id === s0);
  check("Pool de B: uno solo de A no es suyo y no cuenta cursos", r0?.mine === 0 && r0?.courseCount === 0, r0);
  check("Pool de B: el compartido sí es suyo", rowsB.find((r) => r.id === s15)?.mine === 1);
  check("En General todos son «mine»", pool({ kind: "all" }).rows.every((r) => r.mine === 1));
  check("isStudentInPool: alumno sí, maestro no", isStudentInPool(s0) && !isStudentInPool(f.a.id));

  // B matricula a un alumno del pool en su curso: pasa a ser suyo, sin ver lo de A
  check("B matricula a un alumno que registró A", enrollStudents(f.coursesB[1], [s0], f.b.id) === 1);
  check("Tras matricularlo, B lo ve como suyo", isStudentVisible(ownScope(f.b), s0));
  const pAfter = getStudentProfile(s0, ownScope(f.b))!;
  check("Ficha de B: solo su curso", pAfter.courses.length === 1 && pAfter.courses[0].courseId === f.coursesB[1], pAfter.courses);
  const bPerms = studentAccountPermissions(f.b, s0);
  check("Sigue con A: B no restablece ni desactiva su cuenta", bPerms.mine && !bPerms.canResetPassword && !bPerms.canDeactivate, bPerms);
  // Fuera: las secciones siguientes cuentan el ejemplo exacto (B = 10)
  db.delete(enrollments).where(and(eq(enrollments.courseId, f.coursesB[1]), eq(enrollments.studentId, s0))).run();

  // Alta con un correo que ya está en el pool: no se duplica, se señala al existente
  let existing: unknown = null;
  try {
    await createStudent({ fullName: "Otro nombre", email: `${P}-s00@test.local`, password: "x".repeat(8), createdBy: f.b.id });
  } catch (err) {
    existing = err;
  }
  check(
    "Correo repetido: ExistingStudentError con el alumno del pool",
    existing instanceof ExistingStudentError && existing.studentId === s0,
    String(existing)
  );
  let staff: unknown = null;
  try {
    await createStudent({ fullName: "X", email: `${P}-a@test.local`, password: "x".repeat(8), createdBy: f.b.id });
  } catch (err) {
    staff = err;
  }
  check("Correo de un maestro: error común, no «ya existe»", staff instanceof Error && !(staff instanceof ExistingStudentError));
}

function listingsSection(f: Fixture) {
  console.log("\n— Otras listas por alcance");
  // B no tiene pendientes, grupos, plantillas ni certificados: si un servicio
  // ignorara el alcance, aparecerían los datos demo de la base real
  check("Calificar de B: vacío", gradingQueue(ownScope(f.b)).length === 0);
  const rc = renewalCounts(ownScope(f.b));
  check("Vencimientos de B: 0 y 0", rc.expiring === 0 && rc.expired === 0, rc);
  check("Grupos de B: vacío", listCohorts(ownScope(f.b), { status: "all" }).length === 0);
  check("Plantillas de B: vacío", listTemplates(ownScope(f.b)).length === 0);
  check("Certificados de B: vacío", listTeacherCertificates(ownScope(f.b)).length === 0);
  check("Cursos con certificados de B: vacío", listCertificateCourses(ownScope(f.b)).length === 0);

  // Un grupo en un curso de A: lo ven A y «General», no B (cae con el curso en cleanup)
  const cohortId = nanoid();
  db.insert(cohorts).values({ id: cohortId, courseId: f.coursesA[0], name: `${P} Grupo A`, createdBy: f.a.id }).run();
  const has = (scope: Parameters<typeof listCohorts>[0]) => listCohorts(scope, { status: "all" }).some((c) => c.id === cohortId);
  check("Grupo de A: A lo ve", has(ownScope(f.a)));
  check("Grupo de A: General lo ve", has({ kind: "all" }));
  check("Grupo de A: B no lo ve", !has(ownScope(f.b)));
  check("Grupo de A: opciones del alcance", cohortOptionsForUser(ownScope(f.a)).some((c) => c.id === cohortId) && !cohortOptionsForUser(ownScope(f.b)).some((c) => c.id === cohortId));
}

function optionsSection(f: Fixture) {
  console.log("\n— Opciones del selector");
  const opts = listViewContextOptions(f.admin.id);
  const a = opts.teachers.find((t) => t.value === f.a.id);
  const b = opts.teachers.find((t) => t.value === f.b.id);
  check("Maestro A: 5 cursos · 20 alumnos", a?.courses === 5 && a?.students === 20, a);
  check("Maestro B: 2 cursos · 10 alumnos", b?.courses === 2 && b?.students === 10, b);
  check("Mi contenido del admin: 1 curso", opts.own.courses === 1, opts.own);
  const info = viewContextInfo({ kind: "teacher", ownerId: f.a.id });
  check("Info del contexto trae el nombre", info.kind === "teacher" && info.ownerName === `${P} Maestro A`, info);

  db.update(users).set({ active: false }).where(eq(users.id, f.b.id)).run();
  const inactive = listViewContextOptions(f.admin.id).teachers.find((t) => t.value === f.b.id);
  check("Maestro inactivo con cursos sigue en la lista, marcado", inactive?.inactive === true, inactive);
  db.update(users).set({ active: true }).where(eq(users.id, f.b.id)).run();

  // El conteo agregado del selector debe coincidir con la lista, para TODAS las opciones
  const exact = (ownerId: string) => listStudents({ kind: "teacher", ownerId }, { pageSize: 1 }).total;
  const lockstep = (label: string) => {
    const o = listViewContextOptions(f.admin.id);
    for (const t of o.teachers) {
      check(`Selector = lista (${label}): ${t.name}`, t.students === exact(t.value), { selector: t.students, lista: exact(t.value) });
    }
    check(`Selector = lista (${label}): Mi contenido`, o.own.students === exact(f.admin.id));
    check(`Selector = lista (${label}): General`, o.all.students === listStudents({ kind: "all" }, { pageSize: 1 }).total);
  };
  lockstep("base");

  // Bordes: personal inscrito como alumno, solo matrícula dada de baja, alta sin matrícula
  enroll(f.coursesA[0], f.b.id, f.a.id);
  lockstep("maestro inscrito");
  db.delete(enrollments).where(and(eq(enrollments.courseId, f.coursesA[0]), eq(enrollments.studentId, f.b.id))).run();

  const s15 = f.students[15];
  const inB = and(eq(enrollments.courseId, f.coursesB[0]), eq(enrollments.studentId, s15));
  db.update(enrollments).set({ status: "dropped", droppedFrom: "active", droppedAt: new Date(), droppedBy: f.b.id }).where(inB).run();
  lockstep("solo baja");
  db.update(enrollments).set({ status: "active", droppedFrom: null, droppedAt: null, droppedBy: null }).where(inB).run();

  const loner = addUser("s-cnt", "Alumno contado", "student", f.b.id);
  lockstep("alta sin curso");
  check("B cuenta 11 con el alta sin curso", listViewContextOptions(f.admin.id).teachers.find((t) => t.value === f.b.id)?.students === 11);
  db.delete(users).where(eq(users.id, loner)).run();

  // Un maestro inactivo SIN cursos no se ofrece
  const ghost = addUser("t-ghost", "Maestro sin cursos", "teacher");
  db.update(users).set({ active: false }).where(eq(users.id, ghost)).run();
  check("Maestro inactivo sin cursos no aparece", !listViewContextOptions(f.admin.id).teachers.some((t) => t.value === ghost));
  db.delete(users).where(eq(users.id, ghost)).run();
}

function middlewareSection() {
  console.log("\n— Middleware (sin servidor)");
  const run = (path: string, headers: Record<string, string>, method = "GET") =>
    middleware(new NextRequest(`http://lan.test${path}`, { method, headers }));
  const cleared = (res: Response) => /(^|,\s*)vista=;/.test(res.headers.get("set-cookie") ?? "");
  const c = { cookie: "session=s; vista=all" };
  const f5 = run("/teach/dashboard", { accept: "text/html", ...c });
  check("F5 en /teach borra «vista»", cleared(f5), f5.headers.get("set-cookie"));
  const fwd = f5.headers.get("x-middleware-request-cookie");
  check("…y la quita de esta misma petición", fwd !== null && !fwd.includes("vista=") && fwd.includes("session=s"), fwd);
  check("Navegación interna (Accept */*) conserva «vista»", !cleared(run("/teach/dashboard", { accept: "*/*", ...c })));
  check("Acción de servidor conserva «vista»", !cleared(run("/teach/dashboard", { accept: "text/x-component", "next-action": "x", ...c }, "POST")));
  check("Página pública no la borra", !cleared(run("/verify/X", { accept: "text/html", ...c })));
  check("Descarga por /api no la borra", !cleared(run("/api/certificates/zip", { accept: "text/html", ...c })));
  check("Sin cookie «vista» no toca nada", !cleared(run("/teach/dashboard", { accept: "text/html", cookie: "session=s" })));
  check("F5 en la raíz también la borra", cleared(run("/", { accept: "text/html", ...c })));
  check("HEAD no la borra", !cleared(run("/teach/dashboard", { accept: "text/html", ...c }, "HEAD")));
  // OJO: un <form method="get"> nativo es una carga completa y SÍ la borra
  // (por eso los buscadores usan <Form> de next/form, que navega por RSC)
  check("GET de página con ?q= la borra", cleared(run("/teach/students?q=ana", { accept: "text/html", ...c })));
}

function certificatesSection(f: Fixture) {
  console.log("\n— Certificados: alumno, curso y maestro quedan fijos");
  const enrollment = db
    .select()
    .from(enrollments)
    .where(and(eq(enrollments.courseId, f.coursesA[0]), eq(enrollments.studentId, f.students[0])))
    .get()!;
  const issue = (folio: string, snapshot: Record<string, unknown>) => {
    const issuedAt = new Date();
    db.insert(certificates)
      .values({
        id: nanoid(),
        folio,
        enrollmentId: enrollment.id,
        studentId: enrollment.studentId,
        courseId: enrollment.courseId,
        issuedAt,
        templateSnapshot: snapshot,
        pdfFileId: null,
        verificationHash: verificationHash(folio, enrollment.studentId, enrollment.courseId, issuedAt.getTime()),
      })
      .run();
  };
  issue("ZSCOPE-FIJO", {
    fields: [],
    teacherName: `${P} Maestro A`,
    studentName: `${P} Alumno 00`,
    courseTitle: `${P} Curso A1`,
  });
  issue("ZSCOPE-VIEJO", { fields: [] });

  // OJO: el relleno es el mismo de `pnpm certs:backfill` y también completa
  // los certificados reales a los que aún les falte alumno, curso o maestro
  // (idempotente). El perfil muestra los certificados del contexto, no los
  // de otros maestros
  check("Perfil de A: sus 2 certificados", getStudentProfile(f.students[0], ownScope(f.a))!.certificates.length === 2);
  check(
    "Admin viendo como B: sin certificados de A",
    getStudentProfile(f.students[0], { kind: "teacher", ownerId: f.b.id })!.certificates.length === 0
  );

  check("Relleno graba los datos a los viejos", backfillCertificateSnapshots() >= 1);
  check("Relleno es idempotente", backfillCertificateSnapshots() === 0);

  const viejoSnapshot = db
    .select({ templateSnapshot: certificates.templateSnapshot })
    .from(certificates)
    .where(eq(certificates.folio, "ZSCOPE-VIEJO"))
    .get()!.templateSnapshot as { studentName?: string; courseTitle?: string; teacherName?: string } | null;
  check(
    "El relleno completó alumno y curso del viejo",
    viejoSnapshot?.studentName === `${P} Alumno 00` && viejoSnapshot?.courseTitle === `${P} Curso A1`,
    viejoSnapshot
  );

  // Reasignar el curso a B no cambia el instructor de lo ya emitido
  const originalCourseTitle = db
    .select({ title: coursesTable.title })
    .from(coursesTable)
    .where(eq(coursesTable.id, f.coursesA[0]))
    .get()!.title;
  const originalStudentName = db
    .select({ fullName: users.fullName })
    .from(users)
    .where(eq(users.id, f.students[0]))
    .get()!.fullName;

  db.update(coursesTable).set({ ownerId: f.b.id }).where(eq(coursesTable.id, f.coursesA[0])).run();
  const teacherOf = (folio: string) => {
    const v = verifyCertificate(folio);
    return "teacherName" in v ? v.teacherName : null;
  };
  check("/verify conserva al maestro que emitió", teacherOf("ZSCOPE-FIJO") === `${P} Maestro A`, teacherOf("ZSCOPE-FIJO"));
  check("El relleno también quedó fijo", teacherOf("ZSCOPE-VIEJO") === `${P} Maestro A`, teacherOf("ZSCOPE-VIEJO"));

  // Renombrar el curso y corregir el nombre del alumno tampoco cambia lo ya emitido
  db.update(coursesTable).set({ title: `${P} Curso renombrado` }).where(eq(coursesTable.id, f.coursesA[0])).run();
  db.update(users).set({ fullName: `${P} Nombre corregido` }).where(eq(users.id, f.students[0])).run();

  for (const folio of ["ZSCOPE-FIJO", "ZSCOPE-VIEJO"]) {
    const v = verifyCertificate(folio);
    const studentName = "studentName" in v ? v.studentName : null;
    const courseTitle = "courseTitle" in v ? v.courseTitle : null;
    const teacherName = "teacherName" in v ? v.teacherName : null;
    check(`/verify conserva al alumno de ${folio} pese al cambio de nombre`, studentName === originalStudentName, studentName);
    check(`/verify conserva el curso de ${folio} pese al renombre`, courseTitle === originalCourseTitle, courseTitle);
    check(`/verify conserva al maestro de ${folio} pese a la reasignación`, teacherName === `${P} Maestro A`, teacherName);
  }

  db.update(coursesTable).set({ ownerId: f.a.id, title: originalCourseTitle }).where(eq(coursesTable.id, f.coursesA[0])).run();
  db.update(users).set({ fullName: originalStudentName }).where(eq(users.id, f.students[0])).run();

  // La validez es por estado, no por la firma: un certificado firmado con otro
  // APP_SECRET (scripts sin .env, reinstalación) verifica igual; revocado no
  db.insert(certificates)
    .values({
      id: nanoid(),
      folio: "ZSCOPE-FIRMA",
      enrollmentId: enrollment.id,
      studentId: enrollment.studentId,
      courseId: enrollment.courseId,
      issuedAt: new Date(),
      templateSnapshot: { fields: [] },
      pdfFileId: null,
      verificationHash: "x",
    })
    .run();
  const firma = verifyCertificate("ZSCOPE-FIRMA").status;
  check("/verify: hash que no coincide con el secreto → valid", firma === "valid", firma);
  db.update(certificates).set({ revoked: true }).where(eq(certificates.folio, "ZSCOPE-FIRMA")).run();
  const revocado = verifyCertificate("ZSCOPE-FIRMA").status;
  check("/verify: el mismo, revocado → revoked", revocado === "revoked", revocado);
}

type FileKind = (typeof files.$inferInsert)["kind"];
type ItemKind = (typeof courseItems.$inferInsert)["kind"];

async function filesSection(f: Fixture) {
  console.log("\n— Archivos: cada maestro abre solo los de sus cursos");
  // Suben el admin o un alumno: así el atajo «lo subió él» no tapa la revisión
  const student = f.students[15]; // inscrito con A (curso A1) y con B (curso B1)
  const addFile = (kind: FileKind, uploadedBy = f.admin.id, originalName = `${P}.bin`) => {
    const id = nanoid();
    db.insert(files)
      .values({ id, originalName, storedPath: `${P}/${id}`, mimeType: "application/octet-stream", sizeBytes: 1, sha256: "x", uploadedBy, kind })
      .run();
    return id;
  };
  let position = 0;
  const addItem = (courseId: string, kind: ItemKind) => {
    const id = nanoid();
    db.insert(courseItems).values({ id, courseId, position: position++, kind, title: `${P} ${kind}` }).run();
    return id;
  };
  const can = (who: { id: string }, fileId: string) =>
    teacherCanAccessFile(who.id, db.select().from(files).where(eq(files.id, fileId)).get()!);

  // Un archivo en un curso de A y otro en uno de B, colgados igual: cada quien
  // abre el suyo y no el del otro
  const pair = (label: string, kind: FileKind, attach: (courseId: string, fileId: string) => void, uploadedBy?: string) => {
    const inA = addFile(kind, uploadedBy);
    const inB = addFile(kind, uploadedBy);
    attach(f.coursesA[0], inA);
    attach(f.coursesB[0], inB);
    check(`${label}: A abre el suyo y no el de B`, can(f.a, inA) && !can(f.a, inB), { suyo: can(f.a, inA), ajeno: can(f.a, inB) });
    check(`${label}: B abre el suyo y no el de A`, can(f.b, inB) && !can(f.b, inA), { suyo: can(f.b, inB), ajeno: can(f.b, inA) });
  };

  const inDocument = (column: "sourceFileId" | "renderFileId" | "thumbnailFileId") => (courseId: string, fileId: string) => {
    db.insert(itemDocuments).values({ itemId: addItem(courseId, "document"), [column]: fileId }).run();
  };
  pair("Documento original", "course_source", inDocument("sourceFileId"));
  pair("Documento en PDF", "course_render", inDocument("renderFileId"));
  pair("Miniatura", "thumbnail", inDocument("thumbnailFileId"));
  pair("Recurso", "resource", (courseId, fileId) => {
    db.insert(itemResourceFiles).values({ id: nanoid(), itemId: addItem(courseId, "resource"), fileId }).run();
  });
  pair("Adjunto de tarea", "attachment", (courseId, fileId) => {
    db.insert(assignmentAttachments).values({ id: nanoid(), itemId: addItem(courseId, "assignment"), fileId }).run();
  });

  const addSubmission = (courseId: string, fileId: string | null) => {
    const itemId = addItem(courseId, "assignment");
    db.insert(itemAssignments).values({ itemId }).run();
    const id = nanoid();
    db.insert(assignmentSubmissions).values({ id, itemId, studentId: student, fileId, submittedAt: new Date() }).run();
    return id;
  };
  pair("Entrega (archivo principal)", "submission", (courseId, fileId) => void addSubmission(courseId, fileId), student);
  pair(
    "Entrega (varios archivos)",
    "submission",
    (courseId, fileId) => {
      db.insert(submissionFiles).values({ id: nanoid(), submissionId: addSubmission(courseId, null), fileId }).run();
    },
    student
  );

  pair("Certificado en PDF", "certificate", (courseId, fileId) => {
    const enrollment = db
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(and(eq(enrollments.courseId, courseId), eq(enrollments.studentId, student)))
      .get()!;
    db.insert(certificates)
      .values({
        id: nanoid(),
        folio: `ZSCOPE-PDF-${nanoid(8)}`,
        enrollmentId: enrollment.id,
        studentId: student,
        courseId,
        issuedAt: new Date(),
        pdfFileId: fileId,
        verificationHash: "x",
      })
      .run();
  });

  // Las imágenes de pregunta no tienen tipo propio: aquí, una subida como adjunto
  pair("Imagen de pregunta", "attachment", (courseId, fileId) => {
    const itemId = addItem(courseId, "exam");
    db.insert(exams).values({ itemId }).run();
    db.insert(questions).values({ id: nanoid(), examItemId: itemId, position: 0, type: "single_choice", promptMd: "x", imageFileId: fileId }).run();
  });

  // Un mismo archivo en varios cursos: se revisan TODAS las referencias (la de B va primero)
  const shared = addFile("resource");
  for (const courseId of [f.coursesB[0], f.coursesA[0]]) {
    db.insert(itemResourceFiles).values({ id: nanoid(), itemId: addItem(courseId, "resource"), fileId: shared }).run();
  }
  check("Recurso en un curso de B y en uno de A: los dos lo abren", can(f.a, shared) && can(f.b, shared));

  // Fondos de plantilla: de su plantilla, o de la plantilla que usa un curso suyo
  const addTemplate = (ownerId: string, name: string) => {
    const id = nanoid();
    const bg = addFile("template_bg");
    db.insert(certificateTemplates).values({ id, ownerId, name: `${P} ${name}`, backgroundFileId: bg }).run();
    return { id, bg };
  };
  const tplUsed = addTemplate(f.a.id, "Plantilla de A que usa B");
  const tplUnused = addTemplate(f.a.id, "Plantilla de A sin usar");
  const tplB = addTemplate(f.b.id, "Plantilla de B");
  db.update(coursesTable).set({ certificateTemplateId: tplUsed.id }).where(eq(coursesTable.id, f.coursesB[1])).run();
  check("Fondo: A abre los de sus plantillas", can(f.a, tplUsed.bg) && can(f.a, tplUnused.bg));
  check("Fondo: A no abre el de una plantilla de B", !can(f.a, tplB.bg));
  check("Fondo: B abre el de su plantilla", can(f.b, tplB.bg));
  check("Fondo: B abre el de la plantilla de A que usa su curso", can(f.b, tplUsed.bg));
  check("Fondo: B no abre el de una plantilla de A que no usa", !can(f.b, tplUnused.bg));

  // Siempre, lo propio y lo suelto
  for (const kind of ["editor_image", "cover", "branding"] as const) {
    const id = addFile(kind);
    check(`«${kind}»: cualquier maestro lo abre`, can(f.a, id) && can(f.b, id));
  }
  const ownUpload = addFile("submission", f.a.id);
  check("Lo que subió él: A lo abre aunque no cuelgue de nada", can(f.a, ownUpload));
  check("…y B no", !can(f.b, ownUpload));
  const loose = addFile("course_source");
  check("Archivo suelto de otro: ningún maestro lo abre", !can(f.a, loose) && !can(f.b, loose));
  const adminResource = addFile("resource");
  db.insert(itemResourceFiles).values({ id: nanoid(), itemId: addItem(f.courseAdmin, "resource"), fileId: adminResource }).run();
  check("Recurso de un curso del admin: ningún maestro lo abre", !can(f.a, adminResource) && !can(f.b, adminResource));

  // Enlazar: solo lo que subió quien edita, o el admin (nadie engancha a su
  // curso el archivo de otro maestro para abrirlo)
  const errorOf = (fn: () => void) => {
    try {
      fn();
      return "";
    } catch (e) {
      return (e as Error).message;
    }
  };
  const NOT_YOURS = "Ese archivo no lo subiste tú";
  const resItem = addItem(f.coursesA[0], "resource");
  const resOfB = addFile("resource", f.b.id);
  const resOfA = addFile("resource", f.a.id);
  const e1 = errorOf(() => addResourceFile(resItem, resOfB, f.a));
  check("Recurso: A no enlaza un archivo que subió B", e1 === NOT_YOURS, e1);
  check("…y sigue sin poder abrirlo", !can(f.a, resOfB));
  const e2 = errorOf(() => addResourceFile(resItem, resOfA, f.a));
  check("Recurso: A enlaza un archivo que subió él", e2 === "" && resourceItemForFile(resOfA)?.itemId === resItem, e2);
  const e3 = errorOf(() => addResourceFile(resItem, resOfB, f.admin));
  check("Recurso: el admin enlaza cualquiera", e3 === "" && resourceItemForFile(resOfB)?.itemId === resItem, e3);

  const attItem = addItem(f.coursesA[0], "assignment");
  db.insert(itemAssignments).values({ itemId: attItem }).run();
  const attOfB = addFile("attachment", f.b.id);
  const attOfA = addFile("attachment", f.a.id);
  const e4 = errorOf(() => addAssignmentAttachment(attItem, attOfB, f.a));
  check("Adjunto: A no enlaza un archivo que subió B", e4 === NOT_YOURS, e4);
  const e5 = errorOf(() => addAssignmentAttachment(attItem, attOfA, f.a));
  check("Adjunto: A enlaza un archivo que subió él", e5 === "" && attachmentItemForFile(attOfA)?.itemId === attItem, e5);
  const e6 = errorOf(() => addAssignmentAttachment(attItem, attOfB, f.admin));
  check("Adjunto: el admin enlaza cualquiera", e6 === "" && attachmentItemForFile(attOfB)?.itemId === attItem, e6);

  // Documentos: solo un original (course_source) que subió quien edita, o el admin.
  // Los rechazados se llaman «.bin»: si la revisión fallara, el formato no
  // soportado cortaría antes de leer el disco o encolar nada
  const asyncErrorOf = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      return "";
    } catch (e) {
      return (e as Error).message;
    }
  };
  const docItem = addItem(f.coursesA[0], "document");
  db.insert(itemDocuments).values({ itemId: docItem }).run();
  const docOfB = addFile("course_source", f.b.id);
  const e7 = await asyncErrorOf(() => attachDocumentFile(docItem, docOfB, f.a));
  check("A no engancha a su documento un archivo de B", e7 === NOT_YOURS, e7);
  check("…y A sigue sin poder abrir ese documento", !can(f.a, docOfB));
  const submissionFile = addFile("submission", student);
  const e8 = await asyncErrorOf(() => attachDocumentFile(docItem, submissionFile, f.admin));
  check("Una entrega no se puede enganchar como documento (ni el admin)", e8 === "Archivo no válido", e8);

  // Un PPTX no se lee del disco. Su conversión encolada se borra en la misma
  // transacción: el worker del servidor nunca la ve (el archivo no existe)
  const docOfA = addFile("course_source", f.a.id, `${P}.pptx`);
  let attaching: Promise<unknown> = Promise.resolve();
  db.transaction(() => {
    attaching = attachDocumentFile(docItem, docOfA, f.a);
    db.delete(jobs).where(sql`json_extract(${jobs.payload}, '$.itemId') = ${docItem}`).run();
  });
  const e9 = await asyncErrorOf(() => attaching);
  const doc = db.select().from(itemDocuments).where(eq(itemDocuments.itemId, docItem)).get();
  check("A engancha un documento que subió él", e9 === "" && doc?.sourceFileId === docOfA, e9);
}

function generalTemplatesSection(f: Fixture) {
  console.log("\n— Plantillas generales (del admin)");
  // Caen en cleanup: plantillas de usuarios de prueba, después de sus cursos
  const adminTpl = createTemplate(f.admin.id, `${P} Plantilla general`).id;
  const aTpl = createTemplate(f.a.id, `${P} Plantilla de A`).id;

  const forB = listAssignableTemplates(f.b);
  const generalForB = forB.find((t) => t.id === adminTpl);
  check("B puede elegir la del admin, marcada general", generalForB?.general === true, generalForB);
  check("…con el nombre del dueño", generalForB?.ownerName === `${P} Admin`, generalForB?.ownerName);
  check("B no ve la plantilla de A", !forB.some((t) => t.id === aTpl));

  const forA = listAssignableTemplates(f.a);
  const own = forA.find((t) => t.id === aTpl);
  check("A ve la suya (no general) y la general", own?.general === false && forA.some((t) => t.id === adminTpl), own);
  const firstOwn = forA.findIndex((t) => !t.general);
  check(
    "Las generales van primero",
    firstOwn >= 0 && forA.slice(firstOwn).every((t) => !t.general),
    forA.map((t) => [t.name, t.general])
  );

  const forAdmin = listAssignableTemplates(f.admin);
  check(
    "El admin puede elegir todas, con su dueño",
    forAdmin.some((t) => t.id === adminTpl && t.general) &&
      forAdmin.some((t) => t.id === aTpl && !t.general && t.ownerName === `${P} Maestro A`)
  );

  check("Asignar: B la general", canAssignTemplate(f.b, adminTpl));
  check("Asignar: B la de A, no", !canAssignTemplate(f.b, aTpl));
  check("Asignar: A la suya", canAssignTemplate(f.a, aTpl));
  check("Asignar: el admin ambas", canAssignTemplate(f.admin, adminTpl) && canAssignTemplate(f.admin, aTpl));
  check("Asignar: inexistente, nadie", !canAssignTemplate(f.admin, "nope") && !canAssignTemplate(f.b, "nope"));

  const generals = listGeneralTemplates();
  check("Generales: incluye la del admin", generals.some((t) => t.id === adminTpl));
  check("Generales: no incluye la de A", !generals.some((t) => t.id === aTpl));

  // (coursesB[1] ya usa una plantilla de A desde filesSection)
  db.update(coursesTable)
    .set({ certificateTemplateId: adminTpl })
    .where(inArray(coursesTable.id, [f.coursesB[0], f.coursesA[1]]))
    .run();
  const usage = templateUsage();
  check("Uso: la general la usan 2 cursos", usage.get(adminTpl) === 2, usage.get(adminTpl));
  check("Uso: la de A sin cursos no aparece", !usage.has(aTpl));
}

/**
 * Hechos reales con maestros propios: las demás secciones ya publican cursos,
 * cuelgan lecciones y asignan plantillas al fixture, así que estos pasos se
 * miden sobre datos recién creados (mismo prefijo: caen en cleanup).
 */
function onboardingDataSection() {
  console.log("\n— Primeros pasos (hechos reales)");
  // T: dos cursos en borrador, un alumno inscrito, sin lecciones → 2/5
  const t = addUser("t-onb", "Maestro de primeros pasos", "teacher");
  const c1 = addCourse(t, "Curso de primeros pasos 1");
  const c2 = addCourse(t, "Curso de primeros pasos 2");
  const alumno = addUser("s-onb", "Alumno de primeros pasos", "student", t);
  enroll(c1, alumno, t);
  let a = onboardingSteps(onboardingFacts(t));
  check("T: curso y alumnos, sin lección", a.done === 2 && a.next?.key === "lesson", a);
  db.insert(courseItems).values({ id: nanoid(), courseId: c1, kind: "text", title: `${P} lección`, position: 0 }).run();
  // updated_at no se mueve solo: lo adelantamos para que c1 sea el curso reciente
  db.update(coursesTable).set({ status: "published", updatedAt: new Date(Date.now() + 1000) }).where(eq(coursesTable.id, c1)).run();
  a = onboardingSteps(onboardingFacts(t));
  check("T: publicado con inscritos → 4/5, falta diploma", a.done === 4 && a.next?.key === "template", a);
  check("T: el curso reciente es el que se acaba de tocar", a.next?.href === `/teach/courses/${c1}/settings#diploma`, { c1, c2 });
  // La plantilla real de esta base; si no está, se crea una de prueba
  const tplId =
    db.select({ id: certificateTemplates.id }).from(certificateTemplates).where(eq(certificateTemplates.id, "cuKilT2AsPYuG7KC7jroS")).get()?.id ??
    createTemplate(t, `${P} Plantilla de primeros pasos`).id;
  db.update(coursesTable).set({ certificateTemplateId: tplId }).where(eq(coursesTable.id, c1)).run();
  check("T: 5/5", onboardingSteps(onboardingFacts(t)).done === 5);
  // Maestro con un curso vacío y sin alumnos: 1/5
  const solo = addUser("t-onb-solo", "Maestro con un curso", "teacher");
  addCourse(solo, "Curso vacío");
  const n = onboardingSteps(onboardingFacts(solo));
  check("Maestro con 1 curso vacío: 1/5", n.done === 1 && n.next?.key === "lesson", n);
  const ghost = addUser("t-onb-nuevo", "Maestro nuevo", "teacher");
  check("Maestro nuevo: 0/5", onboardingSteps(onboardingFacts(ghost)).done === 0);
  db.delete(users).where(eq(users.id, ghost)).run();
}

async function main() {
  pure();
  onboardingSection();
  middlewareSection();
  try {
    const f = setup();
    scopeSection(f);
    accountSection(f);
    coursesSection(f);
    studentsSection(f);
    await poolSection(f);
    listingsSection(f);
    optionsSection(f);
    certificatesSection(f);
    await filesSection(f);
    generalTemplatesSection(f);
    onboardingDataSection();
  } finally {
    cleanup();
  }

  if (failures) {
    console.log(`\n❌ ${failures} falla(s)`);
    process.exit(1);
  }
  console.log("\n✅ CONTEXTO Y ALUMNOS POR MAESTRO OK");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
