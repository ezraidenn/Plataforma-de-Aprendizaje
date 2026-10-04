import { MailBuilder, type Rendered } from "./render";

/**
 * Los correos de EduCountry (diseño aprobado, estilo «Club» café). Funciones
 * puras: reciben los datos ya resueltos (nombres, fechas en texto, direcciones
 * completas) y devuelven asunto, HTML y texto.
 */

const FOOT_ACCOUNT =
  "EduCountry es la plataforma de capacitación de Yucatán Country Club. Recibes este correo porque tienes una cuenta en EduCountry. Es un mensaje automático: no lo respondas; si tienes dudas, habla con tu instructor.";
const FOOT_SECURITY =
  "EduCountry es la plataforma de capacitación de Yucatán Country Club. Es un mensaje automático: no lo respondas. Nunca te pediremos tu contraseña por correo.";
const footOptional = (why: string) =>
  `EduCountry es la plataforma de capacitación de Yucatán Country Club. ${why} Puedes desactivar estos avisos en Ajustes de tu cuenta.`;

/** «Laura Pérez García» → «Laura» (para el saludo). */
export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || fullName;
}

const ROLE: Record<string, string> = { student: "Estudiante", teacher: "Maestro", admin: "Administrador" };

// 1 ── Bienvenida: crea tu contraseña (el enlace no caduca; sirve una vez)
export function bienvenida(d: { fullName: string; email: string; role: string; url: string }): Rendered {
  const isStaff = d.role !== "student";
  return new MailBuilder("Bienvenido a EduCountry: crea tu contraseña")
    .brand()
    .title(`Te damos la bienvenida, ${firstName(d.fullName)}`)
    .p(
      isStaff
        ? "Yucatán Country Club te dio de alta en *EduCountry*, su plataforma de capacitación. Ahí administrarás cursos, alumnos, calificaciones y certificados."
        : "Yucatán Country Club te dio de alta en *EduCountry*, su plataforma de capacitación. Ahí encontrarás tus cursos, tus evaluaciones y tus certificados."
    )
    .facts([
      ["Tu usuario", d.email],
      ["Tu perfil", ROLE[d.role] ?? d.role],
    ])
    .p("Para entrar por primera vez, elige tu contraseña:")
    .button("Crear mi contraseña", d.url)
    .fallback("El enlace es personal y no caduca: úsalo cuando vayas a entrar por primera vez. Al crear tu contraseña deja de funcionar.", d.url)
    .section("Después")
    .steps([
      "Entra con tu correo y la contraseña que elegiste.",
      isStaff ? "En «Mis cursos» verás los cursos a tu cargo." : "En «Mis cursos» verás lo que tienes asignado.",
      isStaff ? "La «Guía de uso» del menú explica cada pantalla." : "Al aprobar, tu certificado te llega por correo.",
    ])
    .foot(FOOT_SECURITY)
    .build();
}

// 2 ── Restablecer contraseña (autoservicio o hecho por un instructor/admin)
export function restablecer(d: {
  fullName: string;
  email: string;
  url: string;
  minutes: number;
  /** Quién lo pidió por la persona (instructor o admin); vacío = la persona misma */
  requestedBy?: string | null;
}): Rendered {
  const vence = d.minutes >= 120 ? `${Math.round(d.minutes / 60)} horas` : `${d.minutes} minutos`;
  const b = new MailBuilder("Restablece tu contraseña de EduCountry").brand();
  if (d.requestedBy) {
    b.title("Tu acceso fue restablecido").p(
      `Hola, ${firstName(d.fullName)}. *${d.requestedBy}* restableció el acceso a tu cuenta *${d.email}*. Elige una contraseña nueva para volver a entrar:`
    );
  } else {
    b.title("¿Olvidaste tu contraseña?").p(
      `Hola, ${firstName(d.fullName)}. Recibimos una solicitud para restablecer la contraseña de tu cuenta *${d.email}*.`
    );
  }
  return b
    .button("Crear nueva contraseña", d.url)
    .fallback(`El enlace vence en ${vence} y sirve una sola vez.`, d.url)
    .note(
      d.requestedBy ? "¿No lo esperabas?" : "¿No lo pediste tú?",
      d.requestedBy
        ? "Habla con tu instructor antes de usar el enlace."
        : "Ignora este correo: tu contraseña sigue igual. Si te llegan varios sin haberlos pedido, avisa a tu instructor."
    )
    .foot(FOOT_SECURITY)
    .build();
}

// 3 ── Cambios en tu cuenta (contraseña o correo). El de correo va al ANTERIOR.
export function cambioCuenta(d: {
  fullName: string;
  what: "password" | "email";
  when: string;
  account: string;
  newEmail?: string;
  recoverUrl: string;
}): Rendered {
  const isPass = d.what === "password";
  const rows: [string, string][] = isPass
    ? [
        ["Qué cambió", "La contraseña"],
        ["Cuándo", d.when],
        ["Cuenta", d.account],
      ]
    : [
        ["Qué cambió", "El correo de acceso"],
        ["Cuándo", d.when],
        ["Correo anterior", d.account],
        ["Correo nuevo", d.newEmail ?? ""],
      ];
  return new MailBuilder(isPass ? "Se cambió la contraseña de tu cuenta EduCountry" : "Se cambió el correo de tu cuenta EduCountry")
    .brand()
    .title(isPass ? "Cambió la contraseña de tu cuenta" : "Cambió el correo de tu cuenta")
    .p(`Hola, ${firstName(d.fullName)}. Te avisamos de este cambio por seguridad:`)
    .facts(rows)
    .p(isPass ? "Si fuiste tú, no tienes que hacer nada." : "Si fuiste tú (o lo pediste), no tienes que hacer nada. A partir de ahora entras con el correo nuevo.")
    .note("¿No fuiste tú?", isPass ? "Recupera tu cuenta ahora y avisa a tu instructor." : "Avisa de inmediato a tu instructor o al administrador de la plataforma.", "warn")
    .ghostButton(isPass ? "Restablecer mi contraseña" : "Ir a EduCountry", d.recoverUrl)
    .foot(FOOT_SECURITY)
    .build();
}

// 4 ── Te inscribieron (uno o varios cursos en un solo correo)
export function inscripcion(d: {
  fullName: string;
  email: string;
  courses: { title: string; teacher: string; lessons: number; validity: string | null; url: string }[];
  dashboardUrl: string;
}): Rendered {
  const n = d.courses.length;
  const subject =
    n === 1 ? `Te inscribieron en ${d.courses[0].title}` : `Te inscribieron en ${n} cursos de EduCountry`;
  return new MailBuilder(subject)
    .brand()
    .title(n === 1 ? `Tienes un curso nuevo, ${firstName(d.fullName)}` : `Tienes cursos nuevos, ${firstName(d.fullName)}`)
    .p(n === 1 ? "Yucatán Country Club te inscribió en este curso. Ya puedes empezarlo:" : "Yucatán Country Club te inscribió en estos cursos. Ya puedes empezarlos:")
    .cards(
      d.courses.map((c) => ({
        title: c.title,
        lines: [
          [`Instructor: ${c.teacher}`, `${c.lessons} ${c.lessons === 1 ? "lección" : "lecciones"}`, ...(c.validity ? [`Certificado vigente ${c.validity}`] : [])].join(" · "),
        ],
        link: { label: "Abrir el curso", url: c.url },
      }))
    )
    .button("Ir a mis cursos", d.dashboardUrl)
    .p(`Entra con tu correo ${d.email}. ¿Olvidaste tu contraseña? Puedes recuperarla en la pantalla de inicio.`, { small: true, muted: true })
    .foot(FOOT_ACCOUNT)
    .build();
}

// 5 ── Aprobaste: tu certificado
export function certificado(d: {
  fullName: string;
  course: string;
  folio: string;
  issued: string;
  validUntil: string | null;
  courseUrl: string;
  verifyUrl: string;
}): Rendered {
  return new MailBuilder(`Aprobaste ${d.course}: tu certificado está listo`)
    .brand()
    .title(`¡Felicidades, ${firstName(d.fullName)}! Aprobaste`)
    .certificate(d.course, d.fullName)
    .facts([
      ["Folio", d.folio],
      ["Emitido", d.issued],
      ["Vigente hasta", d.validUntil ?? "Sin vencimiento"],
    ])
    .button("Descargar mi certificado", d.courseUrl)
    .link("Verificar autenticidad", d.verifyUrl)
    .p("Cualquier persona puede comprobar que tu certificado es auténtico con el folio o con el código QR impreso en él.", { small: true, muted: true })
    .foot(FOOT_ACCOUNT)
    .build();
}

// 6 ── Tu certificado vence pronto (una sola vez, 30 días antes)
export function vencimiento(d: {
  fullName: string;
  course: string;
  folio: string;
  issued: string;
  expires: string;
  daysLeft: number;
  courseUrl: string;
}): Rendered {
  return new MailBuilder(`Tu certificado de ${d.course} vence el ${d.expires}`)
    .brand()
    .title(d.daysLeft <= 1 ? "Tu certificado vence mañana" : `Tu certificado vence en ${d.daysLeft} días`)
    .p(`Hola, ${firstName(d.fullName)}. Este curso requiere recertificación periódica para mantenerse vigente:`)
    .facts(
      [
        ["Curso", d.course],
        ["Folio", d.folio],
        ["Emitido", d.issued],
        ["Vence", d.expires],
      ],
      { highlightLast: true }
    )
    .p("Tu instructor te inscribirá en la recertificación. Si ya la tienes programada, no tienes que hacer nada.")
    .button("Ver mi certificado", d.courseUrl)
    .foot(footOptional("Te avisamos una sola vez antes del vencimiento."))
    .build();
}

// 7 ── Pendientes que cierran pronto (máximo uno al día)
export function pendientes(d: {
  fullName: string;
  items: { kind: "exam" | "assignment" | "returned"; title: string; course: string; when: string; detail?: string; url: string }[];
  dashboardUrl: string;
}): Rendered {
  const n = d.items.length;
  const first = d.items[0];
  const subject = n === 1 ? `Tienes un pendiente que cierra pronto: ${first.title}` : `Tienes ${n} pendientes que cierran pronto`;
  const chip = { exam: { label: "Examen" }, assignment: { label: "Tarea" }, returned: { label: "Tarea devuelta", tone: "warn" as const } };
  const action = { exam: "Presentarlo", assignment: "Entregarla", returned: "Corregir y reenviar" };
  return new MailBuilder(subject)
    .brand()
    .title(n === 1 ? `Tienes un pendiente, ${firstName(d.fullName)}` : `Tienes ${n} pendientes, ${firstName(d.fullName)}`)
    .p("Estas actividades cierran pronto:")
    .cards(
      d.items.map((it) => ({
        chip: chip[it.kind],
        title: it.title,
        lines: [it.detail ? `${it.course} · «${it.detail}»` : it.course],
        aside: it.when,
        link: { label: action[it.kind], url: it.url },
      }))
    )
    .button("Ver mis pendientes", d.dashboardUrl)
    .foot(footOptional("Te mandamos como máximo un recordatorio al día."))
    .build();
}

// 8 ── Resumen del día del maestro (solo si hay algo)
export function resumenMaestro(d: {
  fullName: string;
  toGrade: { course: string; detail: string }[];
  toGradeTotal: number;
  finished: { total: number; text: string; url: string } | null;
  expiring: { total: number; text: string } | null;
  urls: { grading: string; renewals: string; dashboard: string };
}): Rendered {
  const subject =
    d.toGradeTotal > 0
      ? `Tu resumen de hoy: ${d.toGradeTotal} por calificar`
      : d.expiring
        ? `Tu resumen de hoy: ${d.expiring.total} certificado(s) por vencer`
        : "Tu resumen de hoy en EduCountry";
  const b = new MailBuilder(subject)
    .brand()
    .title(`Buenos días, ${firstName(d.fullName)}`)
    .p("Esto es lo que tienes pendiente hoy en EduCountry:")
    .stats([
      { value: d.toGradeTotal, label: "por calificar", tone: "dark" },
      { value: d.finished?.total ?? 0, label: "terminaron ayer", tone: "soft" },
      { value: d.expiring?.total ?? 0, label: "certificados por vencer", tone: "warn" },
    ]);
  if (d.toGradeTotal > 0) {
    b.section("Por calificar")
      .cards(d.toGrade.map((g) => ({ title: g.course, lines: [g.detail] })))
      .link("Abrir la cola de calificación", d.urls.grading);
  }
  if (d.finished) b.section("Terminaron ayer").p(d.finished.text).link("Ver alumnos del curso", d.finished.url);
  if (d.expiring) b.section("Vencen en los próximos 30 días", "warn").p(d.expiring.text).link("Abrir Vencimientos", d.urls.renewals);
  return b
    .button("Abrir EduCountry", d.urls.dashboard)
    .foot(footOptional("Solo te escribimos los días en que hay algo pendiente."))
    .build();
}

// 9 ── Aviso del maestro (solo si el maestro marcó «también por correo»)
export function aviso(d: {
  title: string;
  message: string;
  from: string;
  course: string | null;
  courseUrl: string | null;
}): Rendered {
  const b = new MailBuilder(d.title)
    .brand()
    .p(`*${d.from}*${d.course ? ` · Instructor de ${d.course}` : " · Instructor"}`, { small: true, muted: true })
    .title(d.title)
    .quote(d.message);
  if (d.courseUrl) b.button("Abrir el curso", d.courseUrl);
  return b
    .foot(footOptional("Este aviso te lo envió tu instructor desde EduCountry; no respondas a este correo, escríbele desde la plataforma."))
    .build();
}

// Prueba de envío (Administración → Configuración)
export function prueba(d: { fullName: string; url: string }): Rendered {
  return new MailBuilder("Prueba de correo de EduCountry")
    .brand()
    .title("El correo funciona")
    .p(`Hola, ${firstName(d.fullName)}. Si lees esto, EduCountry ya puede mandar correos desde el servidor del club.`)
    .button("Abrir EduCountry", d.url)
    .foot(FOOT_ACCOUNT)
    .build();
}
