/**
 * Pruebas de la ayuda visual (tooltips animados): reloj de escenas, textos de
 * cada tema e historias de las escenas. Solo funciones puras; no toca la base.
 *
 * Uso: pnpm smoke:help
 */
import { between, countdownAt, cyclePhase, progressBetween } from "../src/components/help/scene-clock";
import { HELP_TOPICS, type HelpTopicId } from "../src/components/help/topics";
import { CATALOG_FIELDS, CATALOG_GROUPS } from "../src/components/help/catalog-config";
import { parseAllowedTypes, typesLabel } from "../src/lib/file-types";
import { certificateStory, coverStory, sequentialStory, statusStory, validityStory } from "../src/components/help/scenes/course.story";
import {
  CONTENT_KINDS,
  docSecondsStory,
  KIND_HINTS,
  requiredStory,
  resourceLinkStory,
  textSecondsStory,
  typesStory,
  videoSpeedStory,
} from "../src/components/help/scenes/content.story";
import {
  attemptsStory,
  finalScore,
  passingStory,
  resultsStory,
  timeLimitStory,
  timerText,
  windowStory,
} from "../src/components/help/scenes/exam.story";
import { OPEN_ANSWER, openQuestionStory, orderingStory, poolStory, shuffleStory } from "../src/components/help/scenes/exam-bank.story";
import { DRAG_PIECES, imageClickStory, imageDragStory } from "../src/components/help/scenes/exam-image.story";
import { fileTypesStory, lateStory, replaceStory } from "../src/components/help/scenes/assignment.story";
import { groupCloseStory, importStory, renewalsStory, trashStory } from "../src/components/help/scenes/people.story";
import { templateFieldsStory } from "../src/components/help/scenes/certificates.story";
import { coverPlacementStory, STORAGE_TREE, storageStory } from "../src/components/help/scenes/admin.story";
import { allItemsStory, examAverageStory, examSpecificStory, operatorStory, viewingStory } from "../src/components/help/scenes/rules.story";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  }
}

console.log("\n— Reloj de escenas");
check("cyclePhase da la fracción del ciclo", Math.abs(cyclePhase(3500, 7000) - 0.5) < 1e-9);
check("cyclePhase repite en bucle", Math.abs(cyclePhase(7700, 7000) - 0.1) < 1e-9);
check(
  "progressBetween: antes 0, en medio 0.5, después 1",
  progressBetween(0.1, 0.2, 0.6) === 0 &&
    Math.abs(progressBetween(0.4, 0.2, 0.6) - 0.5) < 1e-9 &&
    progressBetween(0.9, 0.2, 0.6) === 1
);
check(
  "countdownAt baja de N a 0",
  countdownAt(0, 30, 0, 0.55) === 30 && countdownAt(0.275, 30, 0, 0.55) === 15 && countdownAt(0.6, 30, 0, 0.55) === 0
);
check("between es [a, b)", between(0.5, 0.5, 0.9) && !between(0.9, 0.5, 0.9));

console.log("\n— Temas y frases");
const ids = Object.keys(HELP_TOPICS) as HelpTopicId[];
check("Hay 37 temas (todas las fases)", ids.length === 37, ids);
for (const id of ids) {
  const t = HELP_TOPICS[id];
  const text = (t.caption as (v: unknown) => string)(t.example);
  check(`${id}: nombre, pantalla, encabezado y frase`, !!t.label && !!t.where && !!t.kicker && text.length > 20 && !/undefined|NaN/.test(text), text);
  check(`${id}: las negritas cierran`, text.split("**").length % 2 === 1, text);
}
check("Segundos por página usa el valor", HELP_TOPICS["content.docSeconds"].caption({ seconds: 45 }).includes("45 s"));
check("Segundos por página en 0", HELP_TOPICS["content.docSeconds"].caption({ seconds: 0 }).includes("Sin tiempo mínimo"));
check("Intentos: uno solo", HELP_TOPICS["exam.attempts"].caption({ attempts: 1, policy: "best" }).includes("Un solo intento"));
check("Intentos: ilimitados", HELP_TOPICS["exam.attempts"].caption({ attempts: null, policy: "last" }).includes("ilimitados"));
check("Intentos: política del promedio", HELP_TOPICS["exam.attempts"].caption({ attempts: 3, policy: "average" }).includes("el promedio"));
check("Vigencia en meses usa el número", HELP_TOPICS["course.validity"].caption({ mode: "months", months: 24 }).includes("24 meses"));
check("Vigencia vitalicia", HELP_TOPICS["course.validity"].caption({ mode: "lifetime", months: null }).includes("nunca vence"));
check("Secuencial apagado cambia la frase", HELP_TOPICS["course.sequential"].caption({ enabled: false }).includes("cualquier lección"));
check("Y/O dice cuál está puesto", HELP_TOPICS["rules.operator"].caption({ op: "OR" }).includes("O (al menos una)"));
check("Estado: borrador dice que solo tú lo ves", HELP_TOPICS["course.status"].caption({ status: "draft" }).includes("solo tú lo ves"));
check("Estado: archivado conserva el avance", HELP_TOPICS["course.status"].caption({ status: "archived" }).includes("se conservan"));
check("Ver contenido usa el mínimo", HELP_TOPICS["rules.viewing"].caption({ min: 80 }).includes("80%"));
check("Examen específico usa el mínimo", HELP_TOPICS["rules.examSpecific"].caption({ min: 90 }).includes("90%"));
check("Lectura: 90 s se dice «1 min 30 s»", HELP_TOPICS["content.textSeconds"].caption({ seconds: 90 }).includes("1 min 30 s"));
check("Lectura sin mínimo", HELP_TOPICS["content.textSeconds"].caption({ seconds: 0 }).includes("al abrirla"));
check("Video apagado: regresa a 1x", HELP_TOPICS["content.videoSpeed"].caption({ allowed: false }).includes("regresa a 1x"));
check("Opcional: 3 de 3", HELP_TOPICS["content.required"].caption({ required: false }).includes("3 de 3"));
check("Enlace: otra pestaña", HELP_TOPICS["content.resourceLink"].caption({ kind: "link" }).includes("otra pestaña"));
check("Ventana sin fechas: siempre abierto", HELP_TOPICS["exam.window"].caption({ opensAt: null, closesAt: null }).includes("siempre abierto"));
check("Tiempo límite usa los minutos", HELP_TOPICS["exam.timeLimit"].caption({ minutes: 45 }).includes("45 min"));
check("Calificación mínima usa el valor", HELP_TOPICS["exam.passing"].caption({ passScore: 70 }).includes("70%"));
check("Pool: toma N del banco", HELP_TOPICS["exam.pool"].caption({ draw: 5, bank: 20 }).includes("5 preguntas al azar"));
check("Pool: todas si N ≥ banco", HELP_TOPICS["exam.pool"].caption({ draw: 25, bank: 20 }).includes("todas las preguntas"));
check("Resultados manual: se muestran al publicar", HELP_TOPICS["exam.results"].caption({ mode: "manual" }).includes("cuando la publiques"));
check("Tardías apagado: se cierra", HELP_TOPICS["assignment.late"].caption({ hasDue: true, allowLate: false }).includes("se cierra"));
check("Tipos de archivo: usa la lista", HELP_TOPICS["assignment.fileTypes"].caption({ types: ".pdf,.docx" }).includes("PDF o DOCX"));
check("Tipos de archivo vacío: cualquiera", HELP_TOPICS["assignment.fileTypes"].caption({ types: "" }).includes("cualquier archivo"));
check("Grupo cerrado: se puede reabrir", HELP_TOPICS["groups.close"].caption({ status: "closed" }).includes("Reabrir"));
check("Vigencia en plantilla: vitalicios se omite", HELP_TOPICS["templates.fields"].caption({ field: "validity" }).includes("vitalicios"));
check("QR: certificado válido", HELP_TOPICS["templates.fields"].caption({ field: "qr" }).includes("Certificado válido"));
check(
  "Portada en ambas",
  HELP_TOPICS["branding.cover"].caption({ placement: "both" }).includes("inicio de sesión") &&
    HELP_TOPICS["branding.cover"].caption({ placement: "both" }).includes("panel de inicio")
);

console.log("\n— Catálogo");
const grouped = CATALOG_GROUPS.flatMap((g) => g.topics);
check(
  "Cada tema aparece en un solo grupo del catálogo",
  grouped.length === ids.length && new Set(grouped).size === ids.length && ids.every((id) => grouped.includes(id)),
  { grouped: grouped.length, ids: ids.length }
);
for (const id of ids) {
  const keys = Object.keys(HELP_TOPICS[id].example);
  const fields = (CATALOG_FIELDS[id] ?? []).map((f) => f.key);
  check(`${id}: el catálogo tiene un control por dato`, keys.every((k) => fields.includes(k)) && fields.every((k) => keys.includes(k)), { keys, fields });
}

console.log("\n— Historia: progresión secuencial");
const seqStart = sequentialStory(0.1, true);
check("Activado: al inicio la 3.ª lección tiene candado", seqStart.lessons[2].state === "locked" && !seqStart.toastVisible);
check("Activado: la 2.ª lección va avanzando", seqStart.lessons[1].state === "current" && (seqStart.lessons[1].progress ?? 0) > 0);
const seqEnd = sequentialStory(0.6, true);
check(
  "Activado: al terminar la 2.ª se abre la 3.ª",
  seqEnd.lessons[1].state === "done" && seqEnd.lessons[2].state === "current" && seqEnd.toastVisible
);
check("Activado: la 4.ª sigue con candado", seqEnd.lessons[3].state === "locked");
check("Desactivado: ninguna lección con candado", sequentialStory(0.1, false).lessons.every((l) => l.state !== "locked"));
check("Desactivado: el alumno salta al examen", sequentialStory(0.6, false).lessons[3].state === "current");

console.log("\n— Historia: vigencia del certificado");
const calendar = (p: number) => validityStory(p, "calendar_year", null);
check(
  "Año calendario: vence el 31 dic 2026",
  calendar(0).expiryLabel === "31 dic 2026" && (calendar(0).certificateLine ?? "").includes("31 de diciembre de 2026"),
  calendar(0)
);
const kinds: string[] = [];
for (let i = 0; i <= 100; i++) {
  const k = calendar(Math.min(i / 100, 0.9999)).badge.kind;
  if (kinds[kinds.length - 1] !== k) kinds.push(k);
}
check("Año calendario: Vigente → Por vencer → Vencido", kinds.join(">") === "valid>expiring>expired", kinds);
check("Al vencer aparece en Vencimientos", calendar(0.9).showPanel && !calendar(0.5).showPanel);
check("12 meses: vence el 15 mar 2027", validityStory(0, "months", 12).expiryLabel === "15 mar 2027", validityStory(0, "months", 12).expiryLabel);
check(
  "Vitalicio: nunca vence ni entra al panel",
  [0.1, 0.5, 0.95].map((p) => validityStory(p, "lifetime", null)).every((s) => s.badge.kind === "lifetime" && !s.showPanel && s.certificateLine === null)
);
check("«Hoy» avanza por la línea", calendar(0.1).todayPos < calendar(0.5).todayPos && calendar(0.5).todayPos < calendar(0.84).todayPos);

console.log("\n— Historia: segundos por página");
const doc = (p: number, s = 30) => docSecondsStory(p, s);
check("Arranca con el valor del ajuste", doc(0).remaining === 30 && doc(0, 45).remaining === 45);
check("A la mitad del conteo falta la mitad", doc(0.275).remaining === 15, doc(0.275));
check("«Siguiente» bloqueado mientras cuenta", !doc(0.3).nextEnabled && !doc(0.3).pageDone);
check("Al llegar a 0: página leída y «Siguiente» activo", doc(0.6).remaining === 0 && doc(0.6).pageDone && doc(0.6).nextEnabled);
check("El segmento de la página se llena después", doc(0.56).segmentFill < 1 && doc(0.7).segmentFill === 1);
check("Sin tiempo mínimo: se acredita de inmediato", doc(0, 0).pageDone && doc(0, 0).nextEnabled);

console.log("\n— Historia: intentos del examen");
check(
  "La mejor / la última / el promedio",
  finalScore([60, 90, 80], "best") === 90 && finalScore([60, 90, 80], "last") === 80 && finalScore([60, 90, 80], "average") === 77
);
const at = (p: number, limit: number | null, policy: "best" | "last" | "average" = "best") => attemptsStory(p, limit, policy);
const first = at(0.05, 3);
check("Empieza respondiendo el intento 1 de 3", first.screen === "answering" && first.attemptLabel === "Intento 1 de 3", first);
const r1 = at(0.25, 3);
check(
  "Intento 1: 60 % no aprueba y ofrece reintentar",
  r1.screen === "result" && r1.score === 60 && !r1.passed && r1.nextLabel === "Reintentar (2 de 3)",
  r1
);
const histBest = at(0.9, 3, "best");
check(
  "Historial con «la mejor»: cuenta el 90 %",
  histBest.screen === "history" && histBest.finalScore === 90 && histBest.rows.filter((r) => r.counted).map((r) => r.n).join() === "2",
  histBest
);
const histLast = at(0.9, 3, "last");
check("Historial con «la última»: cuenta el 80 %", histLast.screen === "history" && histLast.finalScore === 80 && histLast.rows[2].counted && !histLast.rows[1].counted);
const histAvg = at(0.9, 3, "average");
check("Historial con «el promedio»: cuentan todos (77 %)", histAvg.screen === "history" && histAvg.finalScore === 77 && histAvg.rows.every((r) => r.counted));
const one = at(0.9, 1);
check("Un solo intento: el botón se bloquea", one.screen === "history" && one.rows.length === 1 && one.remainingText.includes("bloquea"), one);
const two = at(0.9, 2);
check("Dos intentos: sin intentos al final", two.screen === "history" && two.rows.length === 2 && two.remainingText.includes("Sin intentos"));
const unlimited = at(0.05, null);
check("Ilimitados: se dice en la etiqueta", unlimited.screen === "answering" && unlimited.attemptLabel.includes("ilimitados"));
const five = at(0.9, 5);
check("Con 5 intentos le quedan 2", five.screen === "history" && five.remainingText.includes("2 intentos"), five);

console.log("\n— Historia: Y / O");
check("Primera mitad con Y y sin resultado aún", operatorStory(0.1).activeOp === "AND" && operatorStory(0.1).result === null);
check("Con Y no aprueba (falta el promedio)", operatorStory(0.4).activeOp === "AND" && operatorStory(0.4).result === "fail");
check("Segunda mitad con O", operatorStory(0.6).activeOp === "OR");
check("Con O aprueba con el mismo avance", operatorStory(0.9).result === "pass");
check(
  "Contenido llega a 100 % y promedio a 70 %",
  Math.round(operatorStory(0.3).viewing) === 100 && Math.round(operatorStory(0.3).exams) === 70
);

console.log("\n— Historia: estado del curso");
check("Borrador: el alumno no lo ve", statusStory(0.1).stage === "draft" && !statusStory(0.1).cardInPanel);
check("Publicado: entra a su panel", statusStory(0.5).stage === "published" && statusStory(0.5).cardInPanel);
check(
  "Archivado: sale del panel y se conserva todo",
  statusStory(0.9).stage === "archived" && !statusStory(0.9).cardInPanel && statusStory(0.9).keptNote
);

console.log("\n— Historia: imagen del curso");
check("Al inicio no hay imagen en ningún lado", !coverStory(0.02).uploaded && !coverStory(0.02).inDashboard && !coverStory(0.02).inLogin);
check("Hace clic en «Subir imagen»", coverStory(0.22).pressed && coverStory(0.22).cursorAtUpload);
check("Primero queda en Ajustes", coverStory(0.3).uploaded && !coverStory(0.3).inDashboard);
check("Luego en el panel del alumno y en el login", coverStory(0.5).inDashboard && !coverStory(0.5).inLogin && coverStory(0.9).inLogin);

console.log("\n— Historia: plantilla de certificado");
check("La barra avanza hasta 100 %", certificateStory(0.1).percent > 0 && certificateStory(0.1).percent < 100 && certificateStory(0.35).percent === 100);
check("«¡Aprobaste el curso!» al llegar a 100 %", certificateStory(0.4).toastVisible && !certificateStory(0.2).toastVisible);
check(
  "El diploma se arma por partes",
  certificateStory(0.45).diploma && !certificateStory(0.45).name && certificateStory(0.65).folio && !certificateStory(0.65).qr && certificateStory(0.8).qr
);

console.log("\n— Historia: ver el contenido");
const viewing = (p: number, min = 100) => viewingStory(p, min);
check("Empieza sin lecciones y sin cumplir", viewing(0).lessonsDone === 0 && !viewing(0).passed);
check("Avanza de 20 en 20", viewing(0.3).value % 20 === 0 && viewing(0.3).value > 0 && viewing(0.3).value < 100, viewing(0.3));
check("Con mínimo 100 % se cumple solo al final", !viewing(0.6).passed && viewing(0.8).passed);
check("Con mínimo 60 % se cumple antes", viewing(0.5, 60).passed && viewing(0.5, 60).value >= 60, viewing(0.5, 60));

console.log("\n— Historia: promedio de exámenes");
check(
  "Primero aparecen las calificaciones",
  examAverageStory(0.2, 80).shown === 1 && examAverageStory(0.4, 80).shown === 2 && examAverageStory(0.4, 80).average === null
);
check("Promedio 80 con mínimo 80: cumple", examAverageStory(0.7, 80).average === 80 && examAverageStory(0.7, 80).passed === true);
check("Con mínimo 85: no cumple", examAverageStory(0.7, 85).passed === false);

console.log("\n— Historia: examen específico");
check("Al inicio no hay examen marcado", !examSpecificStory(0.05, 80).focus);
check("Con 85 y mínimo 80 cumple", examSpecificStory(0.7, 80).focus && examSpecificStory(0.7, 80).passed === true);
check("Con mínimo 90 no cumple", examSpecificStory(0.7, 90).passed === false);

console.log("\n— Historia: completar todo lo requerido");
check("Empieza sin nada completado", allItemsStory(0.05).requiredDone === 0 && !allItemsStory(0.05).passed);
check("Antes de terminar no se cumple", !allItemsStory(0.4).passed);
check("Solo cuentan las 3 requeridas", allItemsStory(0.8).requiredDone === 3 && allItemsStory(0.8).passed);

console.log("\n— Historia: tipos de contenido");
const seenKinds: string[] = [];
for (let i = 0; i < 7; i++) seenKinds.push(typesStory(i / 7 + 0.01).kind);
check("Pasan los 7 tipos en orden", seenKinds.join() === CONTENT_KINDS.join(), seenKinds);
check("Cada tipo tiene su explicación", CONTENT_KINDS.every((k) => KIND_HINTS[k].length > 10));
check("Empieza en documento y termina en enlace", typesStory(0).kind === "document" && typesStory(0.999).kind === "link");

console.log("\n— Historia: segundos de lectura");
const txt = (p: number, s = 60) => textSecondsStory(p, s);
check("Arranca con el valor del ajuste", txt(0).remaining === 60 && !txt(0).done);
check("Al llegar a 0: «Lectura completada»", txt(0.56).remaining === 0 && txt(0.56).done && !txt(0.56).showContinue);
check("Después aparece «Continuar»", txt(0.7).showContinue && txt(0.7).percent === 100);
check("Sin mínimo: se completa al abrir", txt(0, 0).done && txt(0, 0).showContinue);

console.log("\n— Historia: velocidad del video");
check("El alumno abre el menú de velocidad", videoSpeedStory(0.2, true).menuOpen && videoSpeedStory(0.2, false).menuOpen);
check("Encendido: sigue a 2x", videoSpeedStory(0.6, true).rate === 2 && !videoSpeedStory(0.6, true).snapBack);
check("Apagado: regresa a 1x", videoSpeedStory(0.5, false).rate === 1 && videoSpeedStory(0.5, false).snapBack);
check("A 2x avanza más", videoSpeedStory(0.9, true).position > videoSpeedStory(0.9, false).position + 0.2);

console.log("\n— Historia: requerido para completar");
check("Requerida: 3 de 4 (75 %)", requiredStory(0.2).mode === "required" && requiredStory(0.2).total === 4 && requiredStory(0.2).percent === 75);
check("Opcional: 3 de 3 (100 %)", requiredStory(0.8).mode === "optional" && requiredStory(0.8).percent === 100);

console.log("\n— Historia: recurso / enlace");
check("Primero el puntero llega al botón", resourceLinkStory(0.2).cursorAtButton && !resourceLinkStory(0.2).done);
check("Al hacer clic se marca «Visto»", resourceLinkStory(0.45).done && !resourceLinkStory(0.45).showNext);
check("Luego aparece «Siguiente lección»", resourceLinkStory(0.6).showNext);

console.log("\n— Tipos de archivo (compartidos con la entrega del alumno)");
check("Normaliza la lista", parseAllowedTypes(".pdf, .DOCX,,").join() === "pdf,docx");
check("Etiqueta legible", typesLabel([]) === "Cualquier archivo" && typesLabel(["pdf"]) === "PDF" && typesLabel(["pdf", "docx", "xlsx"]) === "PDF, DOCX o XLSX");

console.log("\n— Historia: ventana del examen");
const win = (p: number, o = true, c = true) => windowStory(p, o, c);
check("Con ambas fechas: antes, abierto y cerrado", win(0.05).stage === "before" && win(0.5).stage === "open" && win(0.9).stage === "after");
check("Sin fechas: siempre abierto", [0.05, 0.5, 0.9].every((p) => win(p, false, false).stage === "open"));
check("Solo apertura: después queda abierto", win(0.05, true, false).stage === "before" && win(0.9, true, false).stage === "open");
check("Solo cierre: abierto y luego cerrado", win(0.05, false, true).stage === "open" && win(0.9, false, true).stage === "after");

console.log("\n— Historia: tiempo límite");
check("Reloj como el examen real", timerText(754) === "12:34" && timerText(3900) === "1 h 05 min");
check("Arranca con los minutos del ajuste", timeLimitStory(0, 30).remaining === 1800 && timeLimitStory(0, 30).level === "normal");
check("Últimos 5 min en ámbar y último minuto en rojo", timeLimitStory(0.55, 30).level === "warn" && timeLimitStory(0.59, 30).level === "danger");
check(
  "A 0:00 se envía solo con lo contestado",
  timeLimitStory(0.65, 30).expired && timeLimitStory(0.65, 30).submitted && timeLimitStory(0.65, 30).answered === 3 && timeLimitStory(0.65, 30).toast
);
check(
  "Sin límite: no hay reloj y envía al terminar",
  timeLimitStory(0.4, null).remaining === null && timeLimitStory(0.8, null).submitted && timeLimitStory(0.8, null).answered === 5
);

console.log("\n— Historia: calificación mínima");
check("75 % con mínimo 80: no aprueba", passingStory(0.4, 80).score === 75 && passingStory(0.4, 80).verdict === "fail");
check("85 % con mínimo 80: aprueba", passingStory(0.9, 80).score === 85 && passingStory(0.9, 80).verdict === "pass");
check("Sin mínimo: solo «calificado»", passingStory(0.9, null).verdict === "graded");
check("Primero se llena el anillo y luego el veredicto", passingStory(0.1, 80).verdict === null && passingStory(0.1, 80).fill > 0);

console.log("\n— Historia: mostrar resultados");
check("Primero responde y confirma", resultsStory(0.1, "immediately").stage === "answering" && resultsStory(0.25, "immediately").stage === "confirm");
check("Al enviar: ve su calificación", resultsStory(0.4, "immediately").gradeVisible);
check("Al cerrar: primero el aviso, al cierre la calificación", !resultsStory(0.5, "after_close").gradeVisible && resultsStory(0.8, "after_close").gradeVisible);
check("Cuando yo decida: oculta hasta que el instructor publica", !resultsStory(0.5, "manual").gradeVisible && resultsStory(0.6, "manual").publishing && resultsStory(0.9, "manual").gradeVisible);

console.log("\n— Historia: barajar preguntas");
check("Al inicio aparecen en orden", !shuffleStory(0.1, true).mixed && shuffleStory(0.3, true).revealed === 4);
check(
  "Encendido: cada alumno con orden distinto",
  shuffleStory(0.5, true).mixed && shuffleStory(0.5, true).orders[0].join() !== shuffleStory(0.5, true).orders[1].join()
);
check("Apagado: mismo orden para todos", shuffleStory(0.5, false).orders[0].join() === shuffleStory(0.5, false).orders[1].join());
check("Mismas preguntas, solo cambia el orden", [...shuffleStory(0.5, true).orders[0]].sort().join() === "0,1,2,3");
check("El cuadro final (reducir movimiento) queda barajado", shuffleStory(0.97, true).mixed);

console.log("\n— Historia: preguntas por intento");
const pool1 = poolStory(0.4, 5, 20);
const pool2 = poolStory(0.9, 5, 20);
check("Intento 1: salen 5 del banco de 20", pool1.attempt === 1 && pool1.picked.length === 5 && pool1.cards === 20);
check("Intento 2: salen otras 5", pool2.attempt === 2 && pool2.picked.length === 5 && pool2.picked.join() !== pool1.picked.join());
check(
  "Sin límite o más que el banco: todas",
  poolStory(0.4, null, 12).allUsed && poolStory(0.4, null, 12).picked.length === 12 && poolStory(0.4, 30, 12).allUsed
);
check("El dibujo se limita a 20 tarjetas", poolStory(0.4, 5, 50).cards === 20);

console.log("\n— Historia: pregunta abierta");
check("El alumno escribe su respuesta", openQuestionStory(0).typed === 0 && openQuestionStory(0.45).typed === OPEN_ANSWER.length);
check(
  "Al enviar llega a «Por calificar»",
  openQuestionStory(0.4).queue === 2 && openQuestionStory(0.7).queue === 3 && openQuestionStory(0.7).rowVisible && openQuestionStory(0.7).sent
);

console.log("\n— Historia: fecha límite y tardías");
check("Antes de la fecha no hay aviso", !lateStory(0.1, true, true).pastDue);
check("«Hoy» pasa la fecha límite", lateStory(0.4, true, true).pastDue);
check("Acepta tardías: entrega con retraso", lateStory(0.7, true, true).outcome === "late");
check("No acepta tardías: entrega cerrada", lateStory(0.7, true, false).outcome === "closed");
check("Sin fecha límite: entrega a tiempo", lateStory(0.7, false, false).outcome === "onTime" && !lateStory(0.7, false, false).pastDue);

console.log("\n— Historia: reemplazar entrega");
check("La entrega aparece al inicio", !replaceStory(0.02, true).delivered && replaceStory(0.2, true).delivered);
check(
  "Encendido: entrega → confirmar → reemplazada",
  replaceStory(0.2, true).stage === "submitted" && replaceStory(0.5, true).stage === "confirm" && replaceStory(0.8, true).file === "plan-v2.pdf"
);
check("Apagado: la entrega queda fija", replaceStory(0.8, false).stage === "submitted" && replaceStory(0.8, false).file === "plan-v1.pdf");

console.log("\n— Historia: tipos de archivo");
const ft = fileTypesStory(0.4, ".pdf,.docx");
check("Con lista: rechaza el .exe", ft.stage === "rejected" && !ft.badAccepted && ft.badName.endsWith(".exe") && ft.label === "PDF o DOCX");
check("Luego acepta un archivo permitido", fileTypesStory(0.8, ".pdf,.docx").stage === "accepted" && fileTypesStory(0.8, ".pdf,.docx").goodName.endsWith(".pdf"));
check("Lista vacía: acepta cualquier archivo", fileTypesStory(0.4, "").badAccepted && fileTypesStory(0.4, "").label === "Cualquier archivo");
check("Si la lista incluye .exe, prueba con otro", !fileTypesStory(0.4, ".exe,.pdf").badName.endsWith(".exe"));

console.log("\n— Historia: cerrar y reabrir grupo");
check("Abierto: se ven los 5 alumnos", groupCloseStory(0.1).stage === "open" && groupCloseStory(0.1).visibleRows === 5);
check("Cerrado: salen los del grupo", groupCloseStory(0.5).stage === "closed" && groupCloseStory(0.5).visibleRows === 2);
check("Reabierto: vuelven todos", groupCloseStory(0.9).stage === "open" && groupCloseStory(0.9).visibleRows === 5);
check("Clic en el botón antes de cerrar", groupCloseStory(0.27).pressed);

console.log("\n— Historia: traer grupo de otro curso");
check("Primero se elige el grupo", !importStory(0.1).selected && importStory(0.2).selected);
check("Se crea el grupo y se inscriben uno a uno", importStory(0.5).groupCreated && importStory(0.5).copied > 0 && importStory(0.5).copied < 4);
check("Al final están los 4", importStory(0.9).copied === 4);

console.log("\n— Historia: papelera");
check("En la lista y papelera vacía", trashStory(0.1).stage === "list" && trashStory(0.1).trashCount === 0);
check("Quitar lo manda a la Papelera (1)", trashStory(0.35).stage === "removed" && trashStory(0.35).trashCount === 1);
check("En la Papelera se puede restaurar", trashStory(0.6).stage === "sheet" && trashStory(0.6).cursorAt === "restore");
check("Restaurado vuelve a la lista", trashStory(0.9).stage === "restored" && trashStory(0.9).trashCount === 0);

console.log("\n— Historia: reinscribir y descartar");
check("Primero las dos filas", renewalsStory(0.1).laura === "row" && renewalsStory(0.1).ernesto === "row");
check("Reinscribir abre el ciclo 2", renewalsStory(0.4).laura === "cycle2");
check("Descartar pide motivo y saca del panel", renewalsStory(0.6).ernesto === "dialog" && renewalsStory(0.9).ernesto === "gone");

console.log("\n— Historia: campos de la plantilla");
check("Vigencia: con fecha y luego vitalicio sin renglón", templateFieldsStory(0.2, "validity").withValidity && !templateFieldsStory(0.8, "validity").withValidity);
check(
  "QR: el celular se acerca, escanea y verifica",
  templateFieldsStory(0.1, "qr").phoneIn > 0 && templateFieldsStory(0.4, "qr").scanning && templateFieldsStory(0.8, "qr").verified
);

console.log("\n— Historia: carpeta de almacenamiento");
check("Empieza en la raíz del NAS", storageStory(0.02).shown === 1 && storageStory(0.02).upload === "lesson");
check("La lección cae en Cursos › Curso › Módulo", storageStory(0.45).shown === 5 && storageStory(0.45).highlight === 4);
check("La entrega cae en Entregas › … › Alumno", storageStory(0.95).upload === "submission" && storageStory(0.95).shown === STORAGE_TREE.length);

console.log("\n— Historia: dónde se ve la portada");
check("Solo inicio de sesión", coverPlacementStory(0.1).active === "login" && coverPlacementStory(0.1).inLogin && !coverPlacementStory(0.1).inDashboard);
check("Solo panel", coverPlacementStory(0.5).active === "dashboard" && !coverPlacementStory(0.5).inLogin && coverPlacementStory(0.5).inDashboard);
check("Ambas", coverPlacementStory(0.9).inLogin && coverPlacementStory(0.9).inDashboard);

console.log("\n— Historia: arrastrar a la imagen");
const dragRest = imageDragStory(0.02);
check("Arrastrar: en reposo los 3 lugares son el mismo círculo", dragRest.held === null && dragRest.shadows.every((sh) => sh === "circle"), dragRest.shadows);
const dragIcon = imageDragStory(0.12);
check(
  "Arrastrar: al tomar el ícono los 3 lugares se vuelven cuadrados",
  dragIcon.held !== null && DRAG_PIECES[dragIcon.held].kind === "icon" && dragIcon.shadows.every((sh) => sh === "icon"),
  dragIcon
);
check("Arrastrar: el lugar se ilumina antes de encajar", imageDragStory(0.27).hot === imageDragStory(0.27).target && imageDragStory(0.2).hot === null);
const dragText = imageDragStory(0.42);
check(
  "Arrastrar: con la etiqueta, los libres se vuelven píldoras",
  dragText.held !== null && DRAG_PIECES[dragText.held].kind === "text" && dragText.shadows.join() === ",text,text",
  dragText.shadows
);
check("Arrastrar: al soltar, los libres vuelven al círculo", imageDragStory(0.34).held === null && imageDragStory(0.34).shadows.join() === ",circle,circle");
const dragEnd = imageDragStory(0.97);
check("Arrastrar: termina 2 de 3 con un lugar vacío", dragEnd.graded && dragEnd.ok === 2 && dragEnd.total === 3 && dragEnd.placed[2] === null, dragEnd);
check("Arrastrar: el distractor no tiene lugar", DRAG_PIECES.some((p) => p.zone === null) && !dragEnd.placed.includes(DRAG_PIECES.findIndex((p) => p.zone === null)));
check("Arrastrar: la frase dice que los lugares toman la forma", HELP_TOPICS["exam.imageDrag"].caption({}).includes("toman su forma"));

console.log("\n— Historia: señalar en la imagen");
check("Señalar: empieza sin marcas ni círculos", imageClickStory(0.02).marks === 0 && !imageClickStory(0.02).revealed);
check("Señalar: pone las marcas una a una", imageClickStory(0.3).marks === 1 && imageClickStory(0.5).marks === 2);
check("Señalar: los círculos aparecen después de marcar", !imageClickStory(0.5).revealed && imageClickStory(0.6).revealed);
const clickEnd = imageClickStory(0.97);
check("Señalar: una dentro y otra fuera → 1 de 2", clickEnd.graded && clickEnd.hits.join() === "true,false" && clickEnd.ok === 1 && clickEnd.total === 2, clickEnd);
check("Señalar: la frase explica el círculo", HELP_TOPICS["exam.imageClick"].caption({}).includes("dentro de su círculo"));

console.log("\n— Historia: ordenar pasos");
check("Ordenar: empieza revuelto", orderingStory(0.05).order.join() !== "0,1,2,3");
check("Ordenar: el cursor mueve pasos", orderingStory(0.4).moving !== null);
const endOrdering = orderingStory(0.95);
check("Ordenar: termina con un paso fuera de lugar", endOrdering.order.join() === "1,2,3,0");
check("Ordenar: cuenta 2 de 3 pares", endOrdering.graded && endOrdering.pairsOk === 2 && endOrdering.pairsTotal === 3, endOrdering);
check("Ordenar: la frase explica los pares", HELP_TOPICS["exam.ordering"].caption({}).includes("pares"));

if (failures) {
  console.log(`\n❌ ${failures} falla(s)`);
  process.exit(1);
}
console.log("\n✅ AYUDA VISUAL OK");
