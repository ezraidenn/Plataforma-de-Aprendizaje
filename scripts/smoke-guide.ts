/**
 * Guías animadas: cada paso que declara escena la tiene en el registro, cada
 * escena del registro se usa, y todo paso con escena conserva su captura.
 *
 * Uso: pnpm smoke:guide
 */
import fs from "node:fs";
import path from "node:path";
import { STUDENT_GUIDE } from "../src/content/guide/student";
import { TEACHER_GUIDE } from "../src/content/guide/teacher";
import { ADMIN_GUIDE } from "../src/content/guide/admin";
import { GUIDE_SCENES } from "../src/components/guide/scenes/registry";
import { videoWatchStory, watchedPercent } from "../src/components/guide/scenes/video-watch.story";
import { examRunStory, EXAM_RUN_TOTAL } from "../src/components/guide/scenes/exam-run.story";
import { examStartStory, EXAM_START_FACTS } from "../src/components/guide/scenes/exam-start.story";
import { returnedStory } from "../src/components/guide/scenes/returned.story";
import { treeEditStory } from "../src/components/guide/scenes/tree-edit.story";
import { docConvertStory } from "../src/components/guide/scenes/doc-convert.story";
import { videoLinkStory, VIDEO_LINK_URL } from "../src/components/guide/scenes/video-link.story";
import { csvImportStory } from "../src/components/guide/scenes/csv-import.story";
import { rulesRecheckStory } from "../src/components/guide/scenes/rules-recheck.story";
import { gradingQueueStory } from "../src/components/guide/scenes/grading-queue.story";
import { openGradingStory } from "../src/components/guide/scenes/open-grading.story";
import { templateDragStory } from "../src/components/guide/scenes/template-drag.story";
import { newUserStory } from "../src/components/guide/scenes/new-user.story";
import { accountToggleStory } from "../src/components/guide/scenes/account-toggle.story";
import { identityPermissionStory } from "../src/components/guide/scenes/identity-permission.story";
import { reassignOwnerStory, REASSIGN_FROM, REASSIGN_TO } from "../src/components/guide/scenes/reassign-owner.story";
import { jobsQueueStory } from "../src/components/guide/scenes/jobs-queue.story";
import { certOnDemandStory } from "../src/components/guide/scenes/cert-ondemand.story";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  }
}

const GUIDES = [STUDENT_GUIDE, TEACHER_GUIDE, ADMIN_GUIDE];
const SHOTS = path.join(process.cwd(), "public", "guide");

/** Pasos con escena: clave declarada, id del paso y título. */
function declared(): { scene: string; stepId: string; title: string }[] {
  const out: { scene: string; stepId: string; title: string }[] = [];
  for (const guide of GUIDES) {
    for (const section of guide.sections) {
      section.steps.forEach((step, i) => {
        if (step.scene) {
          out.push({ scene: step.scene, stepId: `${guide.role}-${section.id}-${i + 1}`, title: step.title });
        }
      });
    }
  }
  return out;
}

function videoWatch() {
  console.log("\n— Historia: video y tramos vistos");
  const start = videoWatchStory(0.15);
  check("Al principio reproduce y acredita", start.note === "playing" && start.position > 0 && watchedPercent(start) > 0);
  const skip = videoWatchStory(0.34);
  check("Al adelantar avisa que el salto no cuenta", skip.note === "skipped" && skip.position > 0.5);
  check("Adelantar no sube lo acreditado", watchedPercent(skip) === watchedPercent(videoWatchStory(0.3)), [watchedPercent(skip), watchedPercent(videoWatchStory(0.3))]);
  const end = videoWatchStory(0.9);
  check("Al final falta el tramo saltado", end.note === "missing" && watchedPercent(end) < 100 && watchedPercent(end) > 50, watchedPercent(end));
  check("El hueco queda marcado", end.watched.length === 2 && end.watched[1].from > end.watched[0].to);
}

function examRun() {
  console.log("\n— Historia: responder y enviar");
  const first = examRunStory(0.05);
  check("Empieza en la pregunta 1 sin responder", first.stage === "answering" && first.index === 1 && first.picked === null);
  const answered = examRunStory(0.16);
  check("Al responder aparece «Guardado»", answered.picked !== null && answered.saved);
  check("Avanza de pregunta", examRunStory(0.45).index > 1 && examRunStory(0.45).index <= EXAM_RUN_TOTAL);
  check("El reloj baja", examRunStory(0.5).secondsLeft < examRunStory(0.05).secondsLeft);
  check("Confirma antes de enviar", examRunStory(0.68).stage === "confirm");
  check("Termina en «Tu examen fue enviado»", examRunStory(0.9).stage === "sent");
}

function examStart() {
  console.log("\n— Historia: antes de comenzar");
  check("Repasa los cuatro datos del examen", EXAM_START_FACTS.length === 4);
  const first = examStartStory(0.05);
  check("Empieza sin nada resaltado", first.highlighted === null && !first.pressed);
  const mid = examStartStory(0.4);
  check("Va resaltando los datos uno por uno", mid.highlighted !== null && mid.highlighted > 0);
  const press = examStartStory(0.78);
  check("Después el cursor llega al botón", press.cursorAtButton);
  const started = examStartStory(0.95);
  check("Al pulsar arranca el intento y el reloj", started.pressed && started.started);
}

function returned() {
  console.log("\n— Historia: entrega devuelta");
  const sent = returnedStory(0.05);
  check("Primero está entregada y en revisión", sent.stage === "submitted" && sent.score === null);
  const back = returnedStory(0.3);
  check("El instructor la devuelve con comentario", back.stage === "returned" && back.comment.length > 0);
  const fixing = returnedStory(0.55);
  check("El alumno vuelve a entregar", fixing.stage === "resubmitting" && fixing.fileName !== returnedStory(0.05).fileName);
  const graded = returnedStory(0.9);
  check("Termina calificada con puntos", graded.stage === "graded" && graded.score !== null);
}

function teacherStories() {
  console.log("\n— Historias del maestro");

  const menu = treeEditStory(0.1);
  check("Árbol: primero el menú «+ Agregar»", menu.stage === "menu" && menu.rows.every((r) => !r.isNew));
  const added = treeEditStory(0.35);
  check("Árbol: la lección nueva entra al final", added.stage === "added" && added.rows[added.rows.length - 1].isNew === true);
  check("Árbol: se arrastra", treeEditStory(0.6).dragging !== null);
  const settled = treeEditStory(0.95);
  check("Árbol: queda en su lugar (posición 2)", settled.stage === "settled" && settled.rows[1].isNew === true && settled.rows.length === added.rows.length);

  check("Documento: empieza vacío", docConvertStory(0.05).stage === "empty");
  const up = docConvertStory(0.25);
  check("Documento: sube el archivo", up.stage === "uploading" && up.progress > 0 && up.progress < 1);
  check("Documento: lo convierte", docConvertStory(0.55).stage === "converting" && docConvertStory(0.55).pages === 0);
  const ready = docConvertStory(0.9);
  check("Documento: queda listo con sus páginas", ready.stage === "ready" && ready.pages === 12 && ready.fileName.endsWith(".pdf"));

  check("Video: el campo empieza vacío", videoLinkStory(0.05).typed.length === 0);
  const typing = videoLinkStory(0.3);
  check("Video: se escribe el enlace", typing.typed.length > 0 && typing.typed.length < VIDEO_LINK_URL.length && !typing.recognized);
  const preview = videoLinkStory(0.6);
  check("Video: lo reconoce y muestra la vista previa", preview.recognized && preview.preview);
  check("Video: el alumno avanza", videoLinkStory(0.95).studentProgress > 0);

  const pick = csvImportStory(0.05);
  check("CSV: primero se elige el archivo", pick.stage === "pick" && pick.rows.length === 0);
  const preview2 = csvImportStory(0.4);
  check("CSV: previsualiza las 4 filas", preview2.stage === "preview" && preview2.rows.length === 4);
  check("CSV: distingue nuevas, repetidas y con error", preview2.rows.filter((r) => r.result === "new").length === 2 && preview2.rows.filter((r) => r.result === "existing").length === 1 && preview2.rows.filter((r) => r.result === "error").length === 1);
  const done = csvImportStory(0.9);
  check("CSV: solo crea las nuevas", done.stage === "done" && done.created === 2);

  const before = rulesRecheckStory(0.1);
  check("Reglas: falta el examen", before.conditions[0].passed === true && before.conditions[1].passed === null && !before.approved);
  check("Reglas: llega el envío", rulesRecheckStory(0.4).submitted);
  check("Reglas: se cumplen las dos", rulesRecheckStory(0.7).conditions.every((c) => c.passed === true));
  const end = rulesRecheckStory(0.95);
  check("Reglas: aprueba y sale el certificado", end.approved && end.certificate);

  const queue = gradingQueueStory(0.05);
  check("Cola: tres pendientes sin puntos", queue.pending.length === 3 && queue.score === null && queue.stage === "reading");
  check("Cola: se escriben los puntos", gradingQueueStory(0.3).stage === "scoring" && gradingQueueStory(0.3).score !== null);
  check("Cola: se guarda", gradingQueueStory(0.5).stage === "saved" && gradingQueueStory(0.5).done === 1);
  const next = gradingQueueStory(0.95);
  check("Cola: sigue la siguiente entrega", next.pending.length === 2 && next.pending[0].student !== queue.pending[0].student);

  check("Abierta: empieza sin puntos", openGradingStory(0.05, true).stage === "pending" && openGradingStory(0.05, true).points === null);
  check("Abierta: se le ponen puntos", openGradingStory(0.4, true).stage === "scoring" && openGradingStory(0.4, true).points !== null);
  const graded = openGradingStory(0.9, true);
  check("Abierta: el intento queda calificado y avisa", graded.stage === "finalized" && graded.finalPercent !== null && graded.notice === "grade");
  const hidden = openGradingStory(0.9, false);
  check("Abierta: con resultados ocultos el aviso espera", hidden.notice === "hidden" && hidden.finalPercent !== null);

  check("Diploma: el campo empieza quieto", !templateDragStory(0.05).dragging && !templateDragStory(0.05).centerGuide);
  check("Diploma: se arrastra", templateDragStory(0.35).dragging);
  const guided = templateDragStory(0.6);
  check("Diploma: aparecen la guía y la cota", guided.centerGuide && guided.mm !== null);
  const snapped = templateDragStory(0.95);
  check("Diploma: queda centrado al soltar", snapped.snapped && !snapped.dragging && snapped.x === 0.5);
}

function adminStories() {
  console.log("\n— Historias del administrador");

  const form = newUserStory(0.05);
  check("Usuario: empieza con el formulario vacío", form.stage === "form" && form.password === null && form.fields.name === "");
  check("Usuario: se van escribiendo los datos", newUserStory(0.3).fields.name.length > 0);
  const created = newUserStory(0.62);
  check("Usuario: aparece la contraseña temporal con su aviso", created.stage === "created" && created.password !== null && created.warning);
  check("Usuario: y se copia", newUserStory(0.95).copied);

  const on = accountToggleStory(0.05);
  check("Cuenta: activa y con sesiones abiertas", on.active && on.sessions > 0);
  const off = accountToggleStory(0.4);
  check("Cuenta: al desactivar se cierran sus sesiones", !off.active && off.sessions === 0);
  check("Cuenta: y no puede entrar", accountToggleStory(0.55).loginBlocked);
  const back = accountToggleStory(0.95);
  check("Cuenta: no se pierde nada y se puede reactivar", back.active && JSON.stringify(off.keeps) === JSON.stringify(back.keeps));

  const noPerm = identityPermissionStory(0.05);
  check("Identidad: empieza sin permiso", !noPerm.allowed && !noPerm.badge && !noPerm.cardVisible);
  check("Identidad: se enciende el permiso", identityPermissionStory(0.45).allowed);
  check("Identidad: aparece la etiqueta", identityPermissionStory(0.7).badge);
  check("Identidad: el maestro ve la tarjeta en sus Ajustes", identityPermissionStory(0.95).cardVisible);

  const before = reassignOwnerStory(0.05);
  check("Curso: el dueño actual", before.owner === REASSIGN_FROM && !before.picking && !before.done);
  check("Curso: se elige al nuevo maestro", reassignOwnerStory(0.35).picking);
  const after = reassignOwnerStory(0.8);
  check("Curso: queda reasignado", after.done && after.owner === REASSIGN_TO);
  check("Curso: los alumnos y su avance no cambian", JSON.stringify(before.keeps) === JSON.stringify(reassignOwnerStory(0.95).keeps));

  check("Trabajos: empiezan en cola", jobsQueueStory(0.05).jobs[0].status === "pending");
  const running = jobsQueueStory(0.3);
  check("Trabajos: el primero corre", running.jobs[0].status === "running" && running.jobs[0].progress > 0);
  const failed = jobsQueueStory(0.55);
  check("Trabajos: termina y otro queda en error", failed.jobs[0].status === "done" && failed.jobs.filter((j) => j.status === "error").length === 1);
  check("Trabajos: se reintenta", jobsQueueStory(0.7).retrying);
  check("Trabajos: y el que falló sale adelante", jobsQueueStory(0.95).jobs.every((j) => j.status !== "error"));

  const idle = certOnDemandStory(0.05);
  check("Certificado: quieto antes de descargar", idle.stage === "idle" && !idle.reveal.name);
  check("Certificado: se arma al pulsar Descargar", certOnDemandStory(0.35).stage === "building");
  const ready = certOnDemandStory(0.95);
  check("Certificado: queda completo", ready.stage === "ready" && ready.reveal.name && ready.reveal.folio && ready.reveal.qr);
  check("Certificado: nunca ocupa disco", [0.05, 0.35, 0.62, 0.95].every((p) => certOnDemandStory(p).filesOnDisk === 0));
}

function registryChecks() {
  console.log("\n— Registro de escenas");
  const list = declared();
  check("Hay pasos con escena", list.length > 0, list.length);
  for (const { scene, stepId, title } of list) {
    check(`«${title}» usa una escena que existe (${scene})`, scene in GUIDE_SCENES);
    check(`«${title}» conserva su captura`, fs.existsSync(path.join(SHOTS, `${stepId}.jpg`)), stepId);
  }
  const used = new Set(list.map((d) => d.scene));
  for (const key of Object.keys(GUIDE_SCENES)) {
    check(`La escena ${key} se usa en algún paso`, used.has(key));
  }
}

async function main() {
  videoWatch();
  examRun();
  examStart();
  returned();
  teacherStories();
  adminStories();
  registryChecks();

  if (failures) {
    console.log(`\n❌ ${failures} falla(s)`);
    process.exit(1);
  }
  console.log("\n✅ GUÍAS ANIMADAS OK");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
