/**
 * Seed hiperrealista para demo y pruebas:
 *  - Curso completo "Uso y Manejo de Extintores (NOM-002-STPS-2010)" con
 *    3 módulos, PDFs reales generados, video, 2 exámenes (uno con banco
 *    aleatorio, otro con pregunta abierta), tarea entregable, reglas y
 *    plantilla de certificado.
 *  - Curso secundario "Primeros Auxilios Básicos" (en progreso general).
 *  - 24 estudiantes con avance variado: aprobados con certificado, a medio
 *    curso, apenas empezando, sin empezar, exámenes por calificar y tareas
 *    entregadas (incluida una tardía y una devuelta).
 *  - Archiva los cursos de prueba de fases anteriores.
 *
 * Idempotente: si el curso demo ya existe, lo recrea desde cero.
 * Contraseña de TODOS los estudiantes demo: demo1234
 *
 * Uso: pnpm seed:demo
 */
import { eq, like, and, sql } from "drizzle-orm";
import { Readable } from "node:stream";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { db } from "../src/server/db";
import { ownScope } from "../src/server/auth/view-scope";
import {
  users,
  courses as coursesTable,
  itemTexts,
  itemProgress,
  documentProgress,
  videoProgress,
  enrollments,
  certificates as certsTable,
} from "../src/server/db/schema";
import * as courses from "../src/server/services/courses";
import * as tree from "../src/server/services/tree";
import * as examsSvc from "../src/server/services/exams";
import * as video from "../src/server/services/video";
import * as assignments from "../src/server/services/assignments";
import * as grading from "../src/server/services/grading";
import * as certs from "../src/server/services/certificates";
import { attachDocumentFile } from "../src/server/services/documents";
import { saveStream } from "../src/server/services/storage";
import { ensureItemProgress, getEnrollment, bitSet } from "../src/server/services/progress";
import { evaluateEnrollment } from "../src/server/services/rules-engine";
import { updateAssignmentSettings } from "../src/server/services/assignments";

const DAY = 24 * 3600_000;
const now = Date.now();
const daysAgo = (d: number, hourJitter = true) =>
  new Date(now - d * DAY + (hourJitter ? Math.floor(Math.random() * 8 - 4) * 3600_000 : 0));

// ─── Contenido realista ──────────────────────────────────────────────────────

const PDF_MANUAL_PAGES: { title: string; body: string[] }[] = [
  {
    title: "Manual del participante — NOM-002-STPS-2010",
    body: [
      "Condiciones de seguridad, prevención y protección contra incendios",
      "en los centros de trabajo.",
      "",
      "Este manual acompaña al curso de Uso y Manejo de Extintores y es",
      "material de consulta obligatoria para todo el personal operativo,",
      "administrativo y brigadistas.",
      "",
      "Revisión 4 — Departamento de Seguridad e Higiene",
    ],
  },
  {
    title: "1. Marco normativo",
    body: [
      "La NOM-002-STPS-2010 establece los requerimientos minimos de",
      "prevención y protección contra incendios. Obliga al patrón a:",
      "",
      "• Clasificar el riesgo de incendio del centro de trabajo",
      "• Contar con extintores acordes a la clase de fuego",
      "• Ubicarlos a máximo 15 m de recorrido en riesgo ordinario",
      "• Darles mantenimiento y recarga al menos una vez al año",
      "• Capacitar a los trabajadores en su uso (este curso)",
    ],
  },
  {
    title: "2. El tetraedro del fuego",
    body: [
      "Para que exista fuego se requieren cuatro elementos:",
      "",
      "1. COMBUSTIBLE: madera, papel, solventes, gas, grasas...",
      "2. OXIGENO (comburente): el aire contiene ~21%",
      "3. CALOR: la energía de activación (chispa, fricción, flama)",
      "4. REACCION EN CADENA: la combustión se auto-sostiene",
      "",
      "Todo agente extintor actúa eliminando al menos uno de ellos:",
      "enfriando, sofocando, retirando combustible o inhibiendo la reacción.",
    ],
  },
  {
    title: "3. Clases de fuego",
    body: [
      "CLASE A — Sólidos ordinarios: madera, papel, textiles, basura.",
      "CLASE B — Líquidos y gases inflamables: gasolina, thinner, LP.",
      "CLASE C — Equipo eléctrico energizado: tableros, motores, CPU.",
      "CLASE D — Metales combustibles: magnesio, sodio, titanio.",
      "CLASE K — Aceites y grasas de cocina (comedores industriales).",
      "",
      "IMPORTANTE: usar agua en fuego clase C electrocuta; usarla en",
      "clase K provoca proyección violenta de grasa encendida.",
    ],
  },
  {
    title: "4. Agentes extintores",
    body: [
      "AGUA A PRESION — Solo clase A. Enfría.",
      "PQS (polvo químico seco ABC) — Clases A, B y C. El más común",
      "en planta. Inhibe la reacción en cadena.",
      "CO2 (bióxido de carbono) — Clases B y C. No deja residuo:",
      "ideal para tableros y equipo de cómputo. Sofoca y enfría.",
      "ESPUMA AFFF — Clases A y B. Sofoca líquidos inflamables.",
      "ACETATO DE POTASIO (K) — Cocinas. Saponifica la grasa.",
    ],
  },
  {
    title: "5. Técnica PASE",
    body: [
      "P — PASADOR: retira el seguro girando y jalando el pasador.",
      "A — APUNTA: dirige la boquilla a la BASE del fuego, no a la flama.",
      "S — SUJETA/PRESIONA: acciona la palanca con firmeza.",
      "E — ESPARCE: barre de lado a lado cubriendo la base.",
      "",
      "Mantente SIEMPRE entre el fuego y tu ruta de salida, a 2-3 m",
      "del fuego, avanzando solo si el fuego retrocede. Si el extintor",
      "se agota y el fuego persiste: EVACUA y reporta.",
    ],
  },
  {
    title: "6. Inspección mensual del extintor",
    body: [
      "Verifica en tu recorrido mensual:",
      "",
      "• Manómetro en zona VERDE (presión correcta)",
      "• Sello y pasador intactos",
      "• Manguera sin grietas ni obstrucciones",
      "• Etiqueta de recarga vigente (fecha < 12 meses)",
      "• Señalización visible y acceso libre (nada lo bloquea)",
      "• Sin corrosión, golpes o fugas en el cilindro",
      "",
      "Cualquier anomalía se reporta a Seguridad e Higiene el mismo día.",
    ],
  },
  {
    title: "7. Qué hacer ante un conato de incendio",
    body: [
      "1. Da la VOZ DE ALARMA (grita 'FUEGO' y activa la alarma).",
      "2. Evalúa: ¿es un conato (menor a un bote de basura)?",
      "3. Si es conato y estás capacitado: toma el extintor correcto",
      "   y aplica PASE con tu ruta de salida a la espalda.",
      "4. Si NO es conato: evacúa por la ruta señalizada al punto",
      "   de reunión. No uses elevadores. Repórtate con tu brigadista.",
      "",
      "Tu vida vale más que cualquier equipo. Ante la duda: EVACUA.",
    ],
  },
];

const PDF_CLASES_PAGES: { title: string; body: string[] }[] = [
  {
    title: "Guía rápida — Selección de extintor",
    body: ["Material de bolsillo para brigadistas y personal operativo.", "", "Imprime esta guía y colócala junto a cada estación de extintores."],
  },
  {
    title: "Tabla de compatibilidad",
    body: [
      "FUEGO      AGUA   PQS-ABC   CO2    ESPUMA   ACETATO-K",
      "Clase A     SI      SI      NO*      SI        NO",
      "Clase B     NO      SI      SI       SI        NO",
      "Clase C     NO      SI      SI       NO        NO",
      "Clase K     NO      NO      NO       NO        SI",
      "",
      "* CO2 en clase A solo como apoyo; no penetra brasas.",
    ],
  },
  {
    title: "Errores comunes (y cómo evitarlos)",
    body: [
      "• Apuntar a la flama y no a la base: el fuego no se apaga",
      "• Descargar todo de golpe sin barrer: se desperdicia agente",
      "• Dar la espalda al fuego al retirarse: riesgo de reignición",
      "• Usar extintor vencido: presión insuficiente",
      "• Taparse la salida con el propio fuego: quedar atrapado",
    ],
  },
  {
    title: "Distancias y alcance",
    body: [
      "PQS 4.5 kg: alcance efectivo 3-5 m, descarga total ~14 seg.",
      "CO2 4.5 kg: alcance 1.5-2.5 m, descarga ~12 seg.",
      "",
      "Por eso la regla: conato = menor a un bote de basura.",
      "Un extintor portátil NO apaga un incendio desarrollado.",
    ],
  },
];

async function makePdf(pages: { title: string; body: string[] }[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  pages.forEach((page, i) => {
    const p = doc.addPage([612, 792]);
    // banda superior café
    p.drawRectangle({ x: 0, y: 756, width: 612, height: 36, color: rgb(0.365, 0.251, 0.216) });
    p.drawText("Seguridad e Higiene — Capacitación interna", {
      x: 40, y: 768, size: 10, font, color: rgb(1, 1, 1),
    });
    p.drawText(page.title, { x: 40, y: 700, size: 20, font: bold, color: rgb(0.243, 0.169, 0.137) });
    p.drawLine({ start: { x: 40, y: 688 }, end: { x: 572, y: 688 }, thickness: 1.5, color: rgb(0.69, 0.537, 0.408) });
    let y = 650;
    for (const line of page.body) {
      p.drawText(line, { x: 40, y, size: 12, font, color: rgb(0.2, 0.15, 0.13) });
      y -= 22;
    }
    p.drawText(`Página ${i + 1} de ${pages.length}`, { x: 500, y: 30, size: 9, font, color: rgb(0.5, 0.42, 0.37) });
  });
  return Buffer.from(await doc.save());
}

// ─── Estudiantes demo ────────────────────────────────────────────────────────

const STUDENT_NAMES = [
  "María Fernanda López Gutiérrez", "José Luis Hernández Ramírez", "Ana Karen Martínez Flores",
  "Carlos Alberto Sánchez Torres", "Luisa Daniela Pérez Aguilar", "Miguel Ángel Rodríguez Cruz",
  "Sofía Alejandra García Mendoza", "Juan Pablo González Ortiz", "Valeria Jiménez Castillo",
  "Ricardo Morales Vázquez", "Gabriela Reyes Domínguez", "Fernando Castro Salazar",
  "Paola Andrea Ruiz Medina", "Diego Armando Torres Luna", "Alejandra Vargas Ríos",
  "Héctor Manuel Flores Cabrera", "Daniela Guzmán Paredes", "Óscar Iván Ramos Delgado",
  "Karla Patricia Silva Montes", "Andrés Felipe Navarro Campos", "Brenda Lizeth Cortés Peña",
  "Emilio Zapata Fuentes", "Regina Espinosa Valdés", "Mauricio Lara Cisneros",
];

function emailFor(name: string): string {
  const parts = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(" ");
  return `${parts[0]}.${parts[parts.length - 2]}@empresa.local`;
}

// ─── Helpers de progreso directo (los seeds no pueden esperar reloj real) ────

function completeText(enrollmentId: string, itemId: string, when: Date, seconds: number) {
  const ip = ensureItemProgress(enrollmentId, itemId);
  db.update(itemProgress)
    .set({ status: "completed", percent: 100, completedAt: when, lastActivityAt: when, totalSeconds: seconds })
    .where(eq(itemProgress.id, ip.id))
    .run();
}

function docProgress(enrollmentId: string, itemId: string, pagesRead: number, pageCount: number, when: Date) {
  const ip = ensureItemProgress(enrollmentId, itemId);
  let bitmap: Buffer | null = null;
  for (let p = 1; p <= pagesRead; p++) bitmap = bitSet(bitmap, p, pageCount);
  const done = pagesRead >= pageCount;
  db.insert(documentProgress)
    .values({ itemProgressId: ip.id, pagesViewed: bitmap, currentPage: Math.min(pagesRead + 1, pageCount), lastReportedPage: pagesRead, lastHeartbeatAt: when })
    .onConflictDoUpdate({
      target: documentProgress.itemProgressId,
      set: { pagesViewed: bitmap, currentPage: Math.min(pagesRead + 1, pageCount), lastReportedPage: pagesRead, lastHeartbeatAt: when },
    })
    .run();
  db.update(itemProgress)
    .set({
      status: done ? "completed" : "in_progress",
      percent: Math.round((pagesRead / pageCount) * 100),
      completedAt: done ? when : null,
      lastActivityAt: when,
      totalSeconds: pagesRead * 25,
    })
    .where(eq(itemProgress.id, ip.id))
    .run();
}

function vidProgress(enrollmentId: string, itemId: string, watchedSec: number, durationSec: number, when: Date) {
  const ip = ensureItemProgress(enrollmentId, itemId);
  const done = watchedSec / durationSec >= 0.97;
  db.insert(videoProgress)
    .values({ itemProgressId: ip.id, watchedIntervals: [[0, watchedSec]], maxPosition: watchedSec, lastPosition: watchedSec, lastHeartbeatAt: when })
    .onConflictDoUpdate({
      target: videoProgress.itemProgressId,
      set: { watchedIntervals: [[0, watchedSec]], maxPosition: watchedSec, lastPosition: watchedSec, lastHeartbeatAt: when },
    })
    .run();
  db.update(itemProgress)
    .set({
      status: done ? "completed" : "in_progress",
      percent: done ? 100 : Math.round((watchedSec / durationSec) * 100),
      completedAt: done ? when : null,
      lastActivityAt: when,
      totalSeconds: watchedSec,
    })
    .where(eq(itemProgress.id, ip.id))
    .run();
}

async function main() {
  const teacher = db.select().from(users).where(eq(users.email, "maestro@empresa.local")).get()!;
  // Roberto Martínez puede editar la identidad de la empresa (pruebas)
  db.update(users).set({ canEditBranding: true }).where(eq(users.id, teacher.id)).run();

  console.log("— Limpiando notificaciones huérfanas (de cursos ya borrados)");
  db.run(sql`DELETE FROM notifications
    WHERE json_extract(payload, '$.courseId') IS NOT NULL
      AND json_extract(payload, '$.courseId') NOT IN (SELECT id FROM courses)`);

  console.log("— Archivando cursos de prueba de fases anteriores");
  for (const c of db
    .select()
    .from(coursesTable)
    .where(like(coursesTable.title, "Curso de demo%"))
    .all()) {
    courses.setCourseStatus(c.id, "archived");
  }
  for (const c of db.select().from(coursesTable).where(like(coursesTable.title, "Curso demo F%")).all()) {
    courses.setCourseStatus(c.id, "archived");
  }

  const TITLE = "Uso y Manejo de Extintores — NOM-002-STPS-2010";
  for (const c of db.select().from(coursesTable).where(eq(coursesTable.title, TITLE)).all()) {
    db.delete(certsTable).where(eq(certsTable.courseId, c.id)).run();
    courses.deleteCourse(c.id);
  }
  const TITLE2 = "Primeros Auxilios Básicos";
  for (const c of db.select().from(coursesTable).where(eq(coursesTable.title, TITLE2)).all()) {
    db.delete(certsTable).where(eq(certsTable.courseId, c.id)).run();
    courses.deleteCourse(c.id);
  }

  console.log("— Estudiantes demo (contraseña: demo1234)");
  const studentIds: string[] = [];
  for (const name of STUDENT_NAMES) {
    const email = emailFor(name);
    const existing = db.select().from(users).where(eq(users.email, email)).get();
    if (existing) {
      studentIds.push(existing.id);
      continue;
    }
    studentIds.push(
      await courses.createStudent({ fullName: name, email, password: "demo1234", createdBy: teacher.id })
    );
  }
  console.log(`  ${studentIds.length} estudiantes listos`);

  console.log("— Plantilla de certificado (default con adornos)");
  // Borrar plantillas de ejemplo anteriores; los certificados ya emitidos
  // conservan su snapshot, así que esto es seguro
  for (const old of certs.listTemplates(ownScope(teacher))) {
    if (["Diploma demo", "Constancia DC-3 — Extintores", "Certificado de curso"].includes(old.name)) {
      certs.deleteTemplate(old.id);
    }
  }
  const template = certs.createTemplate(teacher.id, "Certificado de curso", "academico");

  console.log("— Curso principal: extintores");
  const course = courses.createCourse({
    ownerId: teacher.id,
    title: TITLE,
    description:
      "Capacitación obligatoria anual en prevención y combate de conatos de incendio. Cumple el requisito de la NOM-002-STPS-2010 para personal operativo, administrativo y brigadistas. Al aprobar se emite tu constancia interna.",
  });
  db.update(coursesTable)
    .set({
      certificateTemplateId: template.id,
      completionRules: {
        op: "AND",
        conditions: [
          { type: "viewing_completion", min_percent: 100 },
          { type: "exam_average", min_percent: 80, scope: "all" },
        ],
      },
    })
    .where(eq(coursesTable.id, course.id))
    .run();

  // ── Módulo 1
  const m1 = tree.createItem({ courseId: course.id, parentId: null, kind: "folder", title: "Módulo 1 — Fundamentos del fuego" });
  const bienvenida = tree.createItem({ courseId: course.id, parentId: m1.id, kind: "text", title: "Bienvenida y objetivos del curso" });
  db.update(itemTexts)
    .set({
      minReadSeconds: 0,
      contentMd: [
        "# Bienvenida",
        "",
        "Este curso forma parte del **programa anual de capacitación en seguridad** y da cumplimiento a la NOM-002-STPS-2010.",
        "",
        "## Al terminar podrás",
        "- Identificar las **clases de fuego** (A, B, C, D y K) y el agente extintor correcto para cada una",
        "- Aplicar la técnica **PASE** para combatir un conato de incendio",
        "- Realizar la **inspección mensual** de los extintores de tu área",
        "- Decidir con criterio cuándo combatir un conato y cuándo **evacuar**",
        "",
        "## Cómo funciona",
        "El curso es **secuencial**: cada lección se desbloquea al completar la anterior. Para aprobar necesitas ver todo el contenido y un **promedio de 80%** en los exámenes. Al aprobar, tu constancia se genera automáticamente.",
        "",
        "Duración estimada: **45 minutos**. ¡Éxito!",
      ].join("\n"),
    })
    .where(eq(itemTexts.itemId, bienvenida.id))
    .run();

  const tetraedro = tree.createItem({ courseId: course.id, parentId: m1.id, kind: "text", title: "La química del fuego: el tetraedro" });
  db.update(itemTexts)
    .set({
      minReadSeconds: 20,
      contentMd: [
        "# El tetraedro del fuego",
        "",
        "El fuego es una **reacción química de oxidación rápida**. Para que exista necesita cuatro elementos simultáneos:",
        "",
        "- **Combustible** — todo material que puede arder: madera, papel, solventes, gas LP, grasa",
        "- **Oxígeno** — el aire que respiramos contiene ~21%; basta 16% para sostener una flama",
        "- **Calor** — la energía de activación: una chispa, fricción, superficie caliente, flama abierta",
        "- **Reacción en cadena** — la combustión libera calor que realimenta el proceso",
        "",
        "**Todo agente extintor funciona eliminando al menos uno de estos elementos.** El agua enfría (quita calor); el CO2 desplaza el oxígeno (sofoca); el polvo químico seco interrumpe la reacción en cadena.",
        "",
        "> Entender esto no es teoría: te dice POR QUÉ no debes usar agua en un fuego eléctrico ni en aceite caliente.",
      ].join("\n"),
    })
    .where(eq(itemTexts.itemId, tetraedro.id))
    .run();

  const manualPdf = await makePdf(PDF_MANUAL_PAGES);
  const manualFile = await saveStream({
    stream: Readable.from(manualPdf),
    originalName: "manual-nom-002-extintores.pdf",
    mimeType: "application/pdf",
    kind: "course_source",
    uploadedBy: teacher.id,
  });
  const manual = tree.createItem({ courseId: course.id, parentId: m1.id, kind: "document", title: "Manual del participante (NOM-002)" });
  await attachDocumentFile(manual.id, manualFile.id, teacher);

  // ── Módulo 2
  const m2 = tree.createItem({ courseId: course.id, parentId: null, kind: "folder", title: "Módulo 2 — Clases de fuego y agentes" });

  const guiaPdf = await makePdf(PDF_CLASES_PAGES);
  const guiaFile = await saveStream({
    stream: Readable.from(guiaPdf),
    originalName: "guia-rapida-seleccion-extintor.pdf",
    mimeType: "application/pdf",
    kind: "course_source",
    uploadedBy: teacher.id,
  });
  const guia = tree.createItem({ courseId: course.id, parentId: m2.id, kind: "document", title: "Guía rápida de selección de extintor" });
  await attachDocumentFile(guia.id, guiaFile.id, teacher);

  const demoVideo = tree.createItem({ courseId: course.id, parentId: m2.id, kind: "video", title: "Demostración práctica de la técnica PASE" });
  video.setVideoLink({
    itemId: demoVideo.id,
    url: "https://www.youtube.com/watch?v=GVBamXXVD30",
    durationSeconds: 32, // duración real del video de YouTube (GVBamXXVD30)
  });

  const parcial = tree.createItem({ courseId: course.id, parentId: m2.id, kind: "exam", title: "Evaluación parcial — Clases de fuego" });
  examsSvc.updateExamSettings(parcial.id, {
    instructionsMd: "Responde con base en el manual y la guía rápida. Cada intento toma **5 preguntas al azar** del banco. Tienes 3 intentos y cuenta tu mejor calificación.",
    maxAttempts: 3,
    attemptScorePolicy: "best",
    timeLimitMinutes: 10,
    passScore: 80,
    shuffleQuestions: true,
    drawCount: 5,
    showResultsMode: "immediately",
  });

  const bank: { q: string; pts: number; opts: [string, boolean][] }[] = [
    { q: "¿Qué clase de fuego corresponde a madera, papel y textiles?", pts: 2, opts: [["Clase A", true], ["Clase B", false], ["Clase C", false], ["Clase K", false]] },
    { q: "¿Qué extintor es el adecuado para un tablero eléctrico energizado?", pts: 2, opts: [["Agua a presión", false], ["CO2 o PQS", true], ["Espuma AFFF", false], ["Acetato de potasio", false]] },
    { q: "El fuego de aceites y grasas de cocina es de clase…", pts: 2, opts: [["A", false], ["B", false], ["D", false], ["K", true]] },
    { q: "¿Por qué NO debe usarse agua en un fuego clase C?", pts: 2, opts: [["Porque evapora demasiado rápido", false], ["Porque conduce la electricidad y puede electrocutar", true], ["Porque aviva la flama", false], ["Sí puede usarse con precaución", false]] },
    { q: "El agente PQS-ABC actúa principalmente…", pts: 2, opts: [["Enfriando el combustible", false], ["Desplazando el oxígeno", false], ["Inhibiendo la reacción en cadena", true], ["Saponificando la grasa", false]] },
    { q: "¿Qué elementos forman el tetraedro del fuego?", pts: 2, opts: [["Combustible, oxígeno, calor y reacción en cadena", true], ["Chispa, aire, madera y humo", false], ["Calor, flama, humo y oxígeno", false], ["Combustible, nitrógeno, calor y presión", false]] },
    { q: "La ventaja del CO2 sobre el PQS en equipo de cómputo es que…", pts: 2, opts: [["Alcanza mayor distancia", false], ["No deja residuo que dañe el equipo", true], ["Funciona en fuegos clase K", false], ["Dura más la descarga", false]] },
    { q: "En un centro de trabajo con riesgo ordinario, la distancia máxima de recorrido hasta un extintor es de…", pts: 2, opts: [["5 metros", false], ["15 metros", true], ["30 metros", false], ["50 metros", false]] },
  ];
  const parcialQs: string[] = [];
  for (const item of bank) {
    parcialQs.push(
      examsSvc.createQuestion(parcial.id, {
        type: "single_choice",
        promptMd: item.q,
        points: item.pts,
        options: item.opts.map(([textMd, isCorrect]) => ({ textMd, isCorrect })),
      })
    );
  }

  // ── Módulo 3
  const m3 = tree.createItem({ courseId: course.id, parentId: null, kind: "folder", title: "Módulo 3 — Práctica y certificación" });

  const pase = tree.createItem({ courseId: course.id, parentId: m3.id, kind: "text", title: "Técnica PASE paso a paso" });
  db.update(itemTexts)
    .set({
      minReadSeconds: 15,
      contentMd: [
        "# Técnica PASE",
        "",
        "Memoriza la secuencia — en una emergencia no habrá tiempo de consultar el manual:",
        "",
        "## P — Pasador",
        "Gira y **jala el pasador** de seguridad. Rompe el sello plástico.",
        "",
        "## A — Apunta",
        "Dirige la boquilla a la **BASE del fuego**, nunca a las flamas. Colócate a 2–3 metros, **con tu ruta de salida a la espalda**.",
        "",
        "## S — Sujeta y presiona",
        "Acciona la palanca con firmeza. La descarga completa de un PQS de 4.5 kg dura **~14 segundos** — no la desperdicies.",
        "",
        "## E — Esparce",
        "**Barre de lado a lado** cubriendo toda la base. Avanza solo si el fuego retrocede. Al extinguir, retírate **sin dar la espalda** y confirma que no haya reignición.",
        "",
        "> Si el extintor se agota y el fuego persiste: **evacúa de inmediato** y repórtalo. Un extintor portátil solo combate conatos.",
      ].join("\n"),
    })
    .where(eq(itemTexts.itemId, pase.id))
    .run();

  const tarea = tree.createItem({ courseId: course.id, parentId: m3.id, kind: "assignment", title: "Croquis de extintores de tu área" });
  updateAssignmentSettings(tarea.id, {
    instructionsMd: [
      "Elabora un **croquis simple de tu área de trabajo** que incluya:",
      "",
      "1. Ubicación de **todos los extintores** (tipo de agente de cada uno)",
      "2. **Rutas de evacuación** y salidas de emergencia",
      "3. Tu **punto de reunión** asignado",
      "4. Al menos **una observación** de mejora (extintor bloqueado, señal caída, recarga vencida...)",
      "",
      "Puede ser a mano (foto en PDF) o digital. Máximo 2 cuartillas.",
    ].join("\n"),
    dueAt: new Date(now + 14 * DAY),
    maxScore: 100,
    allowedFileTypes: ".pdf,.docx,.png,.jpg",
    allowResubmission: true,
    allowLate: true,
  });

  const final = tree.createItem({ courseId: course.id, parentId: m3.id, kind: "exam", title: "Examen final de certificación" });
  examsSvc.updateExamSettings(final.id, {
    instructionsMd: "Examen final del curso. **2 intentos**, 15 minutos, se toma tu mejor calificación. Incluye una pregunta abierta que revisa tu instructor.",
    maxAttempts: 2,
    attemptScorePolicy: "best",
    timeLimitMinutes: 15,
    passScore: 80,
    shuffleQuestions: true,
    showResultsMode: "immediately",
  });
  const fq1 = examsSvc.createQuestion(final.id, {
    type: "single_choice",
    promptMd: "Detectas fuego en una freidora del comedor. ¿Qué extintor usas?",
    points: 2,
    options: [
      { textMd: "Agua a presión", isCorrect: false },
      { textMd: "PQS-ABC", isCorrect: false },
      { textMd: "Acetato de potasio (clase K)", isCorrect: true },
      { textMd: "CO2", isCorrect: false },
    ],
  });
  const fq2 = examsSvc.createQuestion(final.id, {
    type: "multiple_choice",
    promptMd: "¿Qué verificas en la inspección mensual de un extintor? (elige todas las que apliquen)",
    points: 3,
    options: [
      { textMd: "Manómetro en zona verde", isCorrect: true },
      { textMd: "Sello y pasador intactos", isCorrect: true },
      { textMd: "Que pese menos de 2 kg", isCorrect: false },
      { textMd: "Etiqueta de recarga vigente", isCorrect: true },
    ],
  });
  const fq3 = examsSvc.createQuestion(final.id, {
    type: "true_false",
    promptMd: "Al combatir un conato debes colocarte entre el fuego y tu ruta de salida.",
    points: 2,
    options: [
      { textMd: "Verdadero", isCorrect: true },
      { textMd: "Falso", isCorrect: false },
    ],
  });
  const fq4 = examsSvc.createQuestion(final.id, {
    type: "matching",
    promptMd: "Relaciona cada letra de PASE con su acción",
    points: 4,
    config: {
      pairs: [
        { left: "P", right: "Jalar el pasador de seguridad" },
        { left: "A", right: "Apuntar a la base del fuego" },
        { left: "S", right: "Sujetar y presionar la palanca" },
        { left: "E", right: "Esparcer barriendo de lado a lado" },
      ],
    },
  });
  const fq5 = examsSvc.createQuestion(final.id, {
    type: "short_text",
    promptMd: "¿A qué distancia máxima (en metros) debe estar un extintor en riesgo ordinario según la NOM-002?",
    points: 2,
    config: { accepted: ["15", "15 m", "15 metros", "quince"] },
  });
  const fq6 = examsSvc.createQuestion(final.id, {
    type: "open_text",
    promptMd: "Describe con tus palabras qué harías al descubrir un conato de incendio en tu área, desde la voz de alarma hasta decidir si lo combates o evacúas.",
    points: 5,
  });

  courses.publishCourse(course.id);

  // ── Curso secundario
  console.log("— Curso secundario: primeros auxilios");
  const aux = courses.createCourse({
    ownerId: teacher.id,
    title: TITLE2,
    description: "Respuesta inicial ante lesiones comunes en el trabajo: evaluación de la escena, RCP básico y control de hemorragias.",
  });
  const auxIntro = tree.createItem({ courseId: aux.id, parentId: null, kind: "text", title: "La cadena de supervivencia" });
  db.update(itemTexts)
    .set({
      minReadSeconds: 10,
      contentMd: "# La cadena de supervivencia\n\nAnte una emergencia médica, cada minuto cuenta. La secuencia: **1)** asegurar la escena, **2)** activar la emergencia (911 / brigada), **3)** RCP temprano si no responde y no respira, **4)** desfibrilación temprana si hay DEA disponible.\n\n> Nunca te conviertas en la segunda víctima: evalúa la escena ANTES de acercarte.",
    })
    .where(eq(itemTexts.itemId, auxIntro.id))
    .run();
  db.update(coursesTable)
    .set({ certificateTemplateId: template.id })
    .where(eq(coursesTable.id, aux.id))
    .run();
  const auxExam = tree.createItem({ courseId: aux.id, parentId: null, kind: "exam", title: "Evaluación — Conceptos básicos" });
  examsSvc.createQuestion(auxExam.id, {
    type: "single_choice",
    promptMd: "¿Qué es lo PRIMERO al llegar a una escena de emergencia?",
    points: 2,
    options: [
      { textMd: "Iniciar RCP de inmediato", isCorrect: false },
      { textMd: "Verificar que la escena sea segura", isCorrect: true },
      { textMd: "Mover a la víctima", isCorrect: false },
    ],
  });
  courses.publishCourse(aux.id);

  // ── Matricular y simular avance
  console.log("— Matriculando y simulando avance realista");
  courses.enrollStudents(course.id, studentIds, teacher.id);
  courses.enrollStudents(aux.id, studentIds.slice(0, 12), teacher.id);

  const laura = db.select().from(users).where(eq(users.email, "estudiante@empresa.local")).get()!;
  courses.enrollStudents(course.id, [laura.id], teacher.id);

  const MANUAL_PAGES = PDF_MANUAL_PAGES.length;
  const GUIA_PAGES = PDF_CLASES_PAGES.length;
  const VIDEO_SEC = 32;

  const answerParcial = (studentId: string, correctRate: number) => {
    const attempt = examsSvc.startAttempt({ courseId: course.id, studentId, examItemId: parcial.id });
    const drawn = attempt.questionOrder as string[];
    const all = examsSvc.listQuestions(parcial.id);
    for (const qid of drawn) {
      const q = all.find((x) => x.id === qid)!;
      const answerRight = Math.random() < correctRate;
      const pick = answerRight
        ? q.options.filter((o) => o.isCorrect)
        : [q.options.find((o) => !o.isCorrect)!];
      examsSvc.saveAnswer({ studentId, attemptId: attempt.id, questionId: qid, selectedOptionIds: pick.map((o) => o.id) });
    }
    return examsSvc.submitAttempt({ courseId: course.id, studentId, attemptId: attempt.id });
  };

  const answerFinal = (studentId: string, good: boolean, openAnswer: string | null) => {
    const attempt = examsSvc.startAttempt({ courseId: course.id, studentId, examItemId: final.id });
    const pickFor = (qid: string, right: boolean) => {
      const q = examsSvc.listQuestions(final.id).find((x) => x.id === qid)!;
      return (right ? q.options.filter((o) => o.isCorrect) : [q.options.find((o) => !o.isCorrect)!]).map((o) => o.id);
    };
    examsSvc.saveAnswer({ studentId, attemptId: attempt.id, questionId: fq1, selectedOptionIds: pickFor(fq1, good) });
    examsSvc.saveAnswer({ studentId, attemptId: attempt.id, questionId: fq2, selectedOptionIds: pickFor(fq2, true) });
    examsSvc.saveAnswer({ studentId, attemptId: attempt.id, questionId: fq3, selectedOptionIds: pickFor(fq3, good) });
    examsSvc.saveAnswer({
      studentId, attemptId: attempt.id, questionId: fq4,
      answerText: good ? JSON.stringify({ "0": 0, "1": 1, "2": 2, "3": 3 }) : JSON.stringify({ "0": 1, "1": 0, "2": 2, "3": 3 }),
    });
    examsSvc.saveAnswer({ studentId, attemptId: attempt.id, questionId: fq5, answerText: good ? "15 metros" : "30" });
    if (openAnswer) {
      examsSvc.saveAnswer({ studentId, attemptId: attempt.id, questionId: fq6, answerText: openAnswer });
    }
    return examsSvc.submitAttempt({ courseId: course.id, studentId, attemptId: attempt.id });
  };

  const OPEN_ANSWERS = [
    "Primero daría la voz de alarma gritando fuego y activando la estación manual. Evaluaría si es un conato menor a un bote de basura: si lo es y tengo el extintor adecuado, aplicaría PASE con mi salida a la espalda; si crece o se me acaba el agente, evacúo por la ruta al punto de reunión y me reporto con mi brigadista.",
    "Aviso a mis compañeros, activo la alarma y llamo a la brigada. Si el fuego es pequeño uso el extintor PQS apuntando a la base con la técnica PASE. Si no se controla en segundos, cierro la puerta al salir y evacúo sin usar elevadores.",
    "Dar la alarma, pedir apoyo, y solo si es un conato controlable usar el extintor correcto (nunca agua en eléctrico). Mantener la ruta de salida libre detrás de mí y ante cualquier duda evacuar al punto de reunión.",
    "Grito fuego para alertar, evalúo el tamaño. Uso el extintor si es chico aplicando pasador, apuntar, sujetar y esparcir. Superviso que no reencienda y reporto a seguridad.",
  ];

  const contentItems = (upTo: number, sid: string, baseDay: number) => {
    // 0=bienvenida 1=tetraedro 2=manual 3=guia 4=video 5=pase(text)
    const e = getEnrollment(course.id, sid)!;
    if (upTo >= 1) completeText(e.id, bienvenida.id, daysAgo(baseDay), 40);
    if (upTo >= 2) completeText(e.id, tetraedro.id, daysAgo(baseDay - 0.1), 80);
    if (upTo >= 3) docProgress(e.id, manual.id, MANUAL_PAGES, MANUAL_PAGES, daysAgo(baseDay - 0.3));
    if (upTo >= 4) docProgress(e.id, guia.id, GUIA_PAGES, GUIA_PAGES, daysAgo(baseDay - 0.5));
    if (upTo >= 5) vidProgress(e.id, demoVideo.id, VIDEO_SEC, VIDEO_SEC, daysAgo(baseDay - 0.6));
    if (upTo >= 6) completeText(e.id, pase.id, daysAgo(baseDay - 0.8), 60);
  };

  const submitTask = async (sid: string, when: Date, name: string) => {
    const pdf = await makePdf([
      {
        title: "Croquis de extintores — " + name.split(" ")[0],
        body: ["(Entrega de demostración generada por el seed)", "", "Área: Nave 2 — Línea de ensamble", "Extintores: 3 PQS 4.5kg, 1 CO2 en tablero principal", "Observación: el extintor E-12 tiene la señal caída."],
      },
    ]);
    const file = await saveStream({
      stream: Readable.from(pdf),
      originalName: `croquis-${name.split(" ")[0].toLowerCase()}.pdf`,
      mimeType: "application/pdf",
      kind: "submission",
      uploadedBy: sid,
    });
    const sub = assignments.submitAssignment({ courseId: course.id, studentId: sid, itemId: tarea.id, fileId: file.id, comment: "Adjunto mi croquis con la observación del extintor E-12." });
    db.update((await import("../src/server/db/schema")).assignmentSubmissions)
      .set({ submittedAt: when })
      .where(eq((await import("../src/server/db/schema")).assignmentSubmissions.id, sub.id))
      .run();
    return sub;
  };

  // Grupo 1 (6): curso COMPLETO y aprobado → certificado
  for (let i = 0; i < 6; i++) {
    const sid = studentIds[i];
    contentItems(6, sid, 16 - i);
    answerParcial(sid, 1);
    const sub = await submitTask(sid, daysAgo(12 - i), STUDENT_NAMES[i]);
    grading.gradeSubmission({ gradedBy: teacher.id, submissionId: sub.id, score: 85 + i * 2, feedbackMd: "Buen croquis. Gracias por reportar la señal caída — ya se levantó la orden de trabajo.", action: "grade" });
    answerFinal(sid, true, OPEN_ANSWERS[i % OPEN_ANSWERS.length]);
    const pending = grading.attemptForGrading(
      examsSvc.listAttempts(final.id, sid).find((a) => a.status === "submitted")!.id
    )!;
    grading.gradeOpenAnswer({ gradedBy: teacher.id, attemptId: pending.attempt.id, questionId: fq6, points: 5 - (i % 2), feedbackMd: "Respuesta completa: alarma, evaluación y criterio de evacuación correctos." });
    const enrollment = getEnrollment(course.id, sid)!;
    evaluateEnrollment(enrollment.id);
    await certs.issueCertificate(enrollment.id);
  }

  // Grupo 2 (3): todo el contenido + tarea entregada + final ENVIADO con
  // abierta SIN calificar → llenan la cola con exámenes Y tareas
  for (let i = 6; i < 9; i++) {
    const sid = studentIds[i];
    contentItems(6, sid, 6 - (i - 6));
    answerParcial(sid, 0.9);
    await submitTask(sid, daysAgo(2.5 - (i - 6) * 0.5), STUDENT_NAMES[i]);
    answerFinal(sid, true, OPEN_ANSWERS[i % OPEN_ANSWERS.length]);
  }

  // Grupo 3 (3): tarea entregada sin calificar (cola) — 1 tardía simulada
  for (let i = 9; i < 12; i++) {
    const sid = studentIds[i];
    contentItems(6, sid, 4);
    answerParcial(sid, 0.85);
    const sub = await submitTask(sid, daysAgo(i === 11 ? 0.2 : 1.5), STUDENT_NAMES[i]);
    if (i === 10) {
      grading.gradeSubmission({ gradedBy: teacher.id, submissionId: sub.id, action: "return", score: 0, feedbackMd: "Falta el punto de reunión y la observación de mejora. Complétalo y vuelve a subirlo, por favor." });
    }
  }

  // Grupo 4 (6): en progreso variado (matriz con medias lunas)
  const partials: [number, number][] = [
    [3, 5], // leyó hasta el manual completo
    [3, 3], // manual a la mitad
    [4, 2], // guía a la mitad
    [5, 16], // video a la mitad
    [2, 0], // solo textos
    [3, 7], // manual casi completo
  ];
  for (let i = 12; i < 18; i++) {
    const sid = studentIds[i];
    const [upTo, extra] = partials[i - 12];
    const e = getEnrollment(course.id, sid)!;
    contentItems(upTo - 1, sid, 3);
    if (upTo === 3) docProgress(e.id, manual.id, extra, MANUAL_PAGES, daysAgo(1.5));
    if (upTo === 4) docProgress(e.id, guia.id, extra, GUIA_PAGES, daysAgo(1.2));
    if (upTo === 5) vidProgress(e.id, demoVideo.id, extra, VIDEO_SEC, daysAgo(0.8));
    if (upTo === 2) completeText(e.id, tetraedro.id, daysAgo(2), 35);
  }

  // Grupo 5 (3): apenas la bienvenida
  for (let i = 18; i < 21; i++) {
    contentItems(1, studentIds[i], 1);
  }
  // Grupo 6 (3): matriculados sin empezar — nada

  // Laura (estudiante demo): a media guía, para que su "Continuar" caiga ahí
  contentItems(3, laura.id, 2);
  {
    const e = getEnrollment(course.id, laura.id)!;
    docProgress(e.id, guia.id, 2, GUIA_PAGES, daysAgo(0.3));
  }

  // Primeros auxilios: avance ligero de algunos
  for (let i = 0; i < 8; i++) {
    const e = getEnrollment(aux.id, studentIds[i]);
    if (e) completeText(e.id, auxIntro.id, daysAgo(5 - i * 0.3), 30);
  }

  // ── Resumen
  const queue = grading.gradingQueue(ownScope(teacher));
  const certCount = certs.listTeacherCertificates(ownScope(teacher), 1000).filter((c) => c.courseTitle === TITLE).length;
  console.log("\n══════════════════════════════════════════════");
  console.log(`Curso: ${TITLE}`);
  console.log(`  · ${studentIds.length + 1} matriculados (incluida Laura)`);
  console.log(`  · ${certCount} certificados emitidos`);
  console.log(`  · ${queue.length} elementos en la cola de calificación`);
  console.log(`Curso secundario: ${TITLE2} (12 matriculados)`);
  console.log("Estudiantes demo → contraseña: demo1234");
  console.log(`  ej. ${emailFor(STUDENT_NAMES[0])} (aprobada, con certificado)`);
  console.log(`  ej. ${emailFor(STUDENT_NAMES[9])} (tarea entregada, examen pendiente)`);
  console.log(`  ej. ${emailFor(STUDENT_NAMES[13])} (a media lectura del manual)`);
  console.log("══════════════════════════════════════════════");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
