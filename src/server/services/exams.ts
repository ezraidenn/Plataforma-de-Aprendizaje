import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/server/db";
import {
  exams,
  files,
  questions,
  questionOptions,
  examAttempts,
  attemptAnswers,
  itemProgress,
  courseItems,
  courses,
} from "@/server/db/schema";
import { canAccess, ensureItemProgress, getEnrollment } from "./progress";
import { evaluateEnrollment } from "./rules-engine";
import { listAttempts, computeFinalScorePercent } from "./exam-scoring";
import { notify } from "./notifications";
import { categorizePlacement, clozePlacement, imageDragPlacement, matchingToken, orderingToken } from "./exam-answers";
import { orderingScore } from "@/lib/ordering";
import { questionProblem } from "@/lib/question-validation";
import {
  imageClickScore,
  imageDragFileIds,
  imageDragScore,
  parseClickAnswer,
  readImageClick,
  readImageDrag,
} from "@/lib/image-questions";
import { categorizeFileIds, categorizeScore, readCategorize } from "@/lib/categorize";
import { clozeScore, readCloze } from "@/lib/cloze";
import { CLOZE_MODE_LOCKED } from "@/lib/cloze-editor-value";

export { listAttempts, computeFinalScorePercent };

export type Exam = typeof exams.$inferSelect;
export type Question = typeof questions.$inferSelect;
export type QuestionOption = typeof questionOptions.$inferSelect;
export type ExamAttempt = typeof examAttempts.$inferSelect;

// Margen de gracia sobre el deadline (latencia de red del último envío)
const DEADLINE_GRACE_MS = 5_000;

// ─── Configuración del examen (maestro) ──────────────────────────────────────

export function getExam(itemId: string): Exam | null {
  return db.select().from(exams).where(eq(exams.itemId, itemId)).get() ?? null;
}

export function updateExamSettings(
  itemId: string,
  patch: Partial<
    Pick<
      Exam,
      | "instructionsMd"
      | "opensAt"
      | "closesAt"
      | "maxAttempts"
      | "attemptScorePolicy"
      | "timeLimitMinutes"
      | "passScore"
      | "shuffleQuestions"
      | "showResultsMode"
      | "drawCount"
    >
  >
) {
  // Si cambian el cierre o el modo, el aviso «ya están disponibles» por cierre
  // vuelve a quedar pendiente (el worker no repite a quien ya lo recibió)
  const current = getExam(itemId);
  const closesChanged =
    "closesAt" in patch && (patch.closesAt?.getTime() ?? null) !== (current?.closesAt?.getTime() ?? null);
  const modeChanged = "showResultsMode" in patch && patch.showResultsMode !== current?.showResultsMode;
  db.update(exams)
    .set(closesChanged || modeChanged ? { ...patch, resultsNotifiedAt: null } : patch)
    .where(eq(exams.itemId, itemId))
    .run();
}

// ─── Preguntas (maestro) ─────────────────────────────────────────────────────

export function listQuestions(examItemId: string): (Question & { options: QuestionOption[] })[] {
  const qs = db
    .select()
    .from(questions)
    .where(eq(questions.examItemId, examItemId))
    .orderBy(asc(questions.position))
    .all();
  return qs.map((q) => ({
    ...q,
    options: db
      .select()
      .from(questionOptions)
      .where(eq(questionOptions.questionId, q.id))
      .orderBy(asc(questionOptions.position))
      .all(),
  }));
}

export type QuestionInput = {
  type: Question["type"];
  promptMd: string;
  points: number;
  // short_text: {accepted: string[]} · matching: {pairs: [{left, right}]} · ordering: {steps: string[]} ·
  // image_drag: ImageDragConfig · image_click: ImageClickConfig (src/lib/image-questions.ts) ·
  // categorize: CategorizeConfig (src/lib/categorize.ts) · cloze: ClozeConfig (src/lib/cloze.ts)
  config?: unknown;
  options?: { textMd: string; isCorrect: boolean }[];
  /** Foto de fondo de image_drag/image_click; los demás tipos, null. */
  imageFileId?: string | null;
};

export function validateQuestion(input: QuestionInput) {
  const problem = questionProblem(input);
  if (problem) throw new Error(problem);
}

/** Lo que hace falta de una pregunta para saber qué archivos usa. */
type FilesQuestion = { type: Question["type"]; imageFileId?: string | null; config?: unknown };

/**
 * Ids de archivo de una pregunta: la foto de fondo (preguntas sobre imagen) y
 * los que nombra su config, según el tipo; cada módulo puro dice cuáles usa la
 * suya. Un tipo nuevo con imágenes en la config debe sumarse aquí: si no, sus
 * archivos no se revisarían al guardar.
 */
function questionFileIds(q: FilesQuestion): string[] {
  const inConfig =
    q.type === "image_drag" ? imageDragFileIds(q.config) : q.type === "categorize" ? categorizeFileIds(q.config) : [];
  return [...new Set([...(q.imageFileId ? [q.imageFileId] : []), ...inConfig])];
}

/**
 * La foto y los íconos (de arrastrar a la imagen o de las tarjetas de
 * clasificar) deben existir, ser imágenes del editor y haberlas subido este
 * usuario (el admin, cualquiera). Si no, un maestro podría poner de «foto» el
 * id de un archivo ajeno (una entrega, un certificado) y abrirlo por la regla
 * que le deja ver las imágenes de sus preguntas. Al editar, los archivos que
 * la pregunta ya tenía siguen valiendo (p. ej. un curso que cambió de dueño).
 * null = todo bien (también si la pregunta no tiene archivos).
 */
export function questionFilesProblem(
  user: { id: string; role: string },
  q: FilesQuestion,
  questionId?: string
): string | null {
  const ids = questionFileIds(q);
  if (ids.length === 0) return null; // Sin foto: lo dice la validación de la pregunta
  const current = questionId ? db.select().from(questions).where(eq(questions.id, questionId)).get() : undefined;
  const already = new Set(current ? questionFileIds(current) : []);
  const rows = db
    .select({ id: files.id, kind: files.kind, uploadedBy: files.uploadedBy })
    .from(files)
    .where(inArray(files.id, ids))
    .all();
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ok = ids.every((id) => {
    const f = byId.get(id);
    return (
      !!f && f.kind === "editor_image" && (user.role === "admin" || f.uploadedBy === user.id || already.has(id))
    );
  });
  return ok ? null : "Una de las imágenes no es válida; vuelve a subirla.";
}

export function createQuestion(examItemId: string, input: QuestionInput): string {
  validateQuestion(input);
  const id = nanoid();
  const position =
    (db
      .select({ p: questions.position })
      .from(questions)
      .where(eq(questions.examItemId, examItemId))
      .all()
      .reduce((m, r) => Math.max(m, r.p), -1) ?? -1) + 1;

  db.transaction(() => {
    db.insert(questions)
      .values({
        id,
        examItemId,
        position,
        type: input.type,
        promptMd: input.promptMd,
        points: input.points,
        config: input.config ?? null,
        imageFileId: input.imageFileId ?? null,
      })
      .run();
    (input.options ?? []).forEach((o, i) => {
      db.insert(questionOptions)
        .values({ id: nanoid(), questionId: id, position: i, textMd: o.textMd, isCorrect: o.isCorrect })
        .run();
    });
  });
  return id;
}

// Al cambiar la forma de contestar de «Completar el texto» que ya tiene respuestas guardadas (el editor lo avisa igual)
export { CLOZE_MODE_LOCKED };

/**
 * «Completar el texto» con respuestas guardadas (en cualquier intento) no
 * cambia de modo: lo guardado (lo escrito, una ficha de palabra o de opción)
 * no se lee con otro. El texto y las variantes sí se pueden cambiar.
 */
function clozeModeProblem(questionId: string, input: QuestionInput): string | null {
  if (input.type !== "cloze") return null;
  const current = db
    .select({ type: questions.type, config: questions.config })
    .from(questions)
    .where(eq(questions.id, questionId))
    .get();
  if (current?.type !== "cloze") return null;
  const before = (current.config as { mode?: unknown } | null)?.mode;
  const after = (input.config as { mode?: unknown } | null)?.mode;
  if (before === after) return null;
  const saved = db
    .select({ id: attemptAnswers.id })
    .from(attemptAnswers)
    .where(eq(attemptAnswers.questionId, questionId))
    .limit(1)
    .get();
  return saved ? CLOZE_MODE_LOCKED : null;
}

export function updateQuestion(questionId: string, input: QuestionInput) {
  validateQuestion(input);
  db.transaction(() => {
    // Dentro de la transacción: una respuesta guardada entre la revisión y el cambio no se cuela
    const locked = clozeModeProblem(questionId, input);
    if (locked) throw new Error(locked);
    db.update(questions)
      .set({
        type: input.type,
        promptMd: input.promptMd,
        points: input.points,
        config: input.config ?? null,
        imageFileId: input.imageFileId ?? null,
        updatedAt: new Date(),
      })
      .where(eq(questions.id, questionId))
      .run();
    db.delete(questionOptions).where(eq(questionOptions.questionId, questionId)).run();
    (input.options ?? []).forEach((o, i) => {
      db.insert(questionOptions)
        .values({
          id: nanoid(),
          questionId,
          position: i,
          textMd: o.textMd,
          isCorrect: o.isCorrect,
        })
        .run();
    });
  });
}

export function deleteQuestion(examItemId: string, questionId: string) {
  db.transaction(() => {
    db.delete(questions).where(eq(questions.id, questionId)).run();
    const rest = db
      .select()
      .from(questions)
      .where(eq(questions.examItemId, examItemId))
      .orderBy(asc(questions.position))
      .all();
    rest.forEach((q, i) => {
      db.update(questions).set({ position: i }).where(eq(questions.id, q.id)).run();
    });
  });
}

export function duplicateQuestion(examItemId: string, questionId: string): string {
  const q = db.select().from(questions).where(eq(questions.id, questionId)).get();
  if (!q) throw new Error("Pregunta no encontrada");
  const opts = db
    .select()
    .from(questionOptions)
    .where(eq(questionOptions.questionId, questionId))
    .orderBy(asc(questionOptions.position))
    .all();
  return createQuestion(examItemId, {
    type: q.type,
    promptMd: q.promptMd + " (copia)",
    points: q.points,
    config: q.config,
    options: opts.map((o) => ({ textMd: o.textMd, isCorrect: o.isCorrect })),
    // Dentro del mismo examen la copia comparte la foto y los íconos
    imageFileId: q.imageFileId,
  });
}

export function moveQuestion(examItemId: string, questionId: string, direction: "up" | "down") {
  const list = db
    .select()
    .from(questions)
    .where(eq(questions.examItemId, examItemId))
    .orderBy(asc(questions.position))
    .all();
  const idx = list.findIndex((q) => q.id === questionId);
  const target = direction === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || target < 0 || target >= list.length) return;
  db.transaction(() => {
    db.update(questions).set({ position: target }).where(eq(questions.id, list[idx].id)).run();
    db.update(questions).set({ position: idx }).where(eq(questions.id, list[target].id)).run();
  });
}

/** Reordena las preguntas del examen: quedan en el orden de `orderedIds` (posiciones 0..n-1). */
export function reorderQuestions(examItemId: string, orderedIds: string[]) {
  db.transaction(() => {
    orderedIds.forEach((id, i) => {
      db.update(questions).set({ position: i }).where(and(eq(questions.id, id), eq(questions.examItemId, examItemId))).run();
    });
  });
}

export function examMaxScore(examItemId: string): number {
  return listQuestions(examItemId).reduce((sum, q) => sum + q.points, 0);
}

// ─── Ventana e intentos (estudiante) ─────────────────────────────────────────

export type ExamWindowState = "not_open" | "open" | "closed";

export function examWindowState(exam: Exam, now = Date.now()): ExamWindowState {
  if (exam.opensAt && now < exam.opensAt.getTime()) return "not_open";
  if (exam.closesAt && now > exam.closesAt.getTime()) return "closed";
  return "open";
}

function shuffled<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Inicia (o retoma) un intento. Valida acceso, ventana y límite de intentos.
 * El deadline absoluto se fija con el reloj del servidor.
 */
export function startAttempt(opts: {
  courseId: string;
  studentId: string;
  examItemId: string;
}): ExamAttempt {
  const access = canAccess(opts.courseId, opts.studentId, opts.examItemId);
  if (!access.allowed) throw new Error("Este examen está bloqueado");

  const exam = getExam(opts.examItemId);
  if (!exam) throw new Error("Examen no encontrado");

  const state = examWindowState(exam);
  if (state === "not_open") throw new Error("Este examen aún no abre");
  if (state === "closed") throw new Error("Este examen ya cerró");

  const attempts = listAttempts(opts.examItemId, opts.studentId);

  // Retomar intento en curso si sigue dentro del tiempo
  const inProgress = attempts.find((a) => a.status === "in_progress");
  if (inProgress) {
    if (!inProgress.deadlineAt || inProgress.deadlineAt.getTime() + DEADLINE_GRACE_MS > Date.now()) {
      return inProgress;
    }
    // Se agotó el tiempo con el intento abierto: autoenvía y sigue
    submitAttempt({ courseId: opts.courseId, studentId: opts.studentId, attemptId: inProgress.id, auto: true });
  }

  const used = listAttempts(opts.examItemId, opts.studentId).filter(
    (a) => a.status !== "in_progress"
  ).length;
  if (exam.maxAttempts !== null && used >= exam.maxAttempts) {
    throw new Error("Ya usaste todos tus intentos");
  }

  const qs = listQuestions(opts.examItemId);
  if (qs.length === 0) throw new Error("Este examen no tiene preguntas todavía");

  // Pool aleatorio: cada intento toma drawCount preguntas al azar del banco
  // (distintas por alumno/intento). El barajado aplica sobre lo sorteado.
  let pool = qs;
  if (exam.drawCount && exam.drawCount > 0 && exam.drawCount < qs.length) {
    pool = shuffled(qs).slice(0, exam.drawCount);
  }
  const order = exam.shuffleQuestions
    ? shuffled(pool.map((q) => q.id))
    : qs.filter((q) => pool.some((p) => p.id === q.id)).map((q) => q.id);

  const now = Date.now();
  const candidates: number[] = [];
  if (exam.timeLimitMinutes) candidates.push(now + exam.timeLimitMinutes * 60_000);
  if (exam.closesAt) candidates.push(exam.closesAt.getTime());
  const deadlineAt = candidates.length ? new Date(Math.min(...candidates)) : null;

  const id = nanoid();
  const attemptEnrollment = getEnrollment(opts.courseId, opts.studentId);
  db.insert(examAttempts)
    .values({
      id,
      examItemId: opts.examItemId,
      studentId: opts.studentId,
      enrollmentId: attemptEnrollment?.id ?? null,
      attemptNumber: used + 1,
      startedAt: new Date(now),
      deadlineAt,
      maxScoreSnapshot: pool.reduce((s, q) => s + q.points, 0),
      questionOrder: order,
    })
    .run();

  // El examen queda "en progreso" en el árbol
  const enrollment = getEnrollment(opts.courseId, opts.studentId);
  if (enrollment) {
    const ip = ensureItemProgress(enrollment.id, opts.examItemId);
    if (ip.status !== "completed") {
      db.update(itemProgress)
        .set({ status: "in_progress", lastActivityAt: new Date(now), updatedAt: new Date(now) })
        .where(eq(itemProgress.id, ip.id))
        .run();
    }
  }

  return db.select().from(examAttempts).where(eq(examAttempts.id, id)).get()!;
}

function assertAttemptOpen(attempt: ExamAttempt) {
  if (attempt.status !== "in_progress") throw new Error("Este intento ya fue enviado");
  if (attempt.deadlineAt && attempt.deadlineAt.getTime() + DEADLINE_GRACE_MS < Date.now()) {
    throw new Error("El tiempo de este intento ya terminó");
  }
}

export function saveAnswer(opts: {
  studentId: string;
  attemptId: string;
  questionId: string;
  selectedOptionIds?: string[];
  answerText?: string;
}) {
  const attempt = db.select().from(examAttempts).where(eq(examAttempts.id, opts.attemptId)).get();
  if (!attempt || attempt.studentId !== opts.studentId) throw new Error("Intento no encontrado");
  assertAttemptOpen(attempt);

  const existing = db
    .select()
    .from(attemptAnswers)
    .where(
      and(eq(attemptAnswers.attemptId, opts.attemptId), eq(attemptAnswers.questionId, opts.questionId))
    )
    .get();

  if (existing) {
    db.update(attemptAnswers)
      .set({
        selectedOptionIds: opts.selectedOptionIds ?? null,
        answerText: opts.answerText ?? null,
        updatedAt: new Date(),
      })
      .where(eq(attemptAnswers.id, existing.id))
      .run();
  } else {
    db.insert(attemptAnswers)
      .values({
        id: nanoid(),
        attemptId: opts.attemptId,
        questionId: opts.questionId,
        selectedOptionIds: opts.selectedOptionIds ?? null,
        answerText: opts.answerText ?? null,
      })
      .run();
  }
}

// ─── Autocalificación ────────────────────────────────────────────────────────

function gradeAnswer(
  q: Question & { options: QuestionOption[] },
  selectedOptionIds: string[] | null,
  answerText: string | null,
  attemptId: string
): number | null {
  switch (q.type) {
    case "single_choice":
    case "true_false": {
      const correct = q.options.find((o) => o.isCorrect);
      return selectedOptionIds?.length === 1 && selectedOptionIds[0] === correct?.id ? q.points : 0;
    }
    case "multiple_choice": {
      // Puntaje parcial: (correctas marcadas - incorrectas marcadas) / total correctas
      const correctIds = new Set(q.options.filter((o) => o.isCorrect).map((o) => o.id));
      const selected = new Set(selectedOptionIds ?? []);
      let hits = 0;
      let misses = 0;
      for (const id of selected) {
        if (correctIds.has(id)) hits++;
        else misses++;
      }
      const ratio = Math.max(0, (hits - misses) / correctIds.size);
      return Math.round(ratio * q.points * 100) / 100;
    }
    case "short_text": {
      const accepted =
        (q.config as { accepted?: string[] } | null)?.accepted?.map((a) =>
          a.trim().toLowerCase()
        ) ?? [];
      const given = (answerText ?? "").trim().toLowerCase();
      return given && accepted.includes(given) ? q.points : 0;
    }
    case "matching": {
      // answerText = JSON {leftIndex: token}. El token opaco se recalcula con
      // el attemptId; correcto = token del mismo índice (identidad).
      const pairs = (q.config as { pairs?: { left: string; right: string }[] } | null)?.pairs ?? [];
      let map: Record<string, unknown>;
      try {
        map = JSON.parse(answerText ?? "{}");
      } catch {
        return 0;
      }
      if (!map || typeof map !== "object" || pairs.length === 0) return 0;
      let hits = 0;
      for (let i = 0; i < pairs.length; i++) {
        const v = map[String(i)];
        // Formato viejo (intentos en curso previos al token): índice numérico.
        const ok = typeof v === "number" ? v === i : v === matchingToken(attemptId, q.id, i);
        if (ok) hits++;
      }
      return Math.round((hits / pairs.length) * q.points * 100) / 100;
    }
    case "ordering": {
      // answerText = JSON [token, …] en el orden del alumno
      const steps = (q.config as { steps?: string[] } | null)?.steps ?? [];
      let tokens: unknown;
      try {
        tokens = JSON.parse(answerText ?? "[]");
      } catch {
        return 0;
      }
      if (!Array.isArray(tokens) || steps.length < 2) return 0;
      const indexOf = new Map(steps.map((_, i) => [orderingToken(attemptId, q.id, i), i]));
      const order = tokens.map((t) => (typeof t === "string" ? indexOf.get(t) : undefined));
      if (order.some((i) => i === undefined) || new Set(order).size !== steps.length) return 0;
      return Math.round(orderingScore(order as number[]) * q.points * 100) / 100;
    }
    case "image_drag": {
      // Una pregunta incompleta vale cero: no debe tumbar el envío de todo el examen
      const drag = readImageDrag(q);
      if (!drag) return 0;
      const placed = imageDragPlacement(drag.config, answerText, attemptId, q.id);
      return Math.round(imageDragScore(drag.config, placed) * q.points * 100) / 100;
    }
    case "image_click": {
      const click = readImageClick(q);
      if (!click) return 0;
      const marks = parseClickAnswer(answerText, click.config.spots.length);
      return Math.round(imageClickScore(click.config, marks) * q.points * 100) / 100;
    }
    case "categorize": {
      // Igual que las de imagen: incompleta vale cero sin tumbar el envío
      const cat = readCategorize(q);
      if (!cat) return 0;
      const placed = categorizePlacement(cat, answerText, attemptId, q.id);
      return Math.round(categorizeScore(cat, placed) * q.points * 100) / 100;
    }
    case "cloze": {
      const cloze = readCloze(q);
      if (!cloze) return 0;
      const given = clozePlacement(cloze, answerText, attemptId, q.id);
      return Math.round(clozeScore(cloze, given) * q.points * 100) / 100;
    }
    case "open_text":
      return null; // calificación manual (Fase 3)
  }
}

/**
 * Envía el intento: autocalifica lo autocalificable. Si hay preguntas abiertas
 * queda `submitted` (calificación manual en Fase 3); si no, `graded` con
 * finalScore publicado, y se evalúan las reglas del curso.
 */
export function submitAttempt(opts: {
  courseId: string;
  studentId: string;
  attemptId: string;
  auto?: boolean;
}): ExamAttempt {
  const attempt = db.select().from(examAttempts).where(eq(examAttempts.id, opts.attemptId)).get();
  if (!attempt || attempt.studentId !== opts.studentId) throw new Error("Intento no encontrado");
  if (attempt.status !== "in_progress") return attempt;
  if (!opts.auto) assertAttemptOpen(attempt);

  // Calificar SOLO las preguntas del intento (con pool aleatorio, questionOrder
  // es el subconjunto sorteado; las demás preguntas del banco no cuentan)
  const allQs = listQuestions(attempt.examItemId);
  const drawnIds = new Set((attempt.questionOrder as string[] | null) ?? allQs.map((q) => q.id));
  const qs = allQs.filter((q) => drawnIds.has(q.id));
  const answers = db
    .select()
    .from(attemptAnswers)
    .where(eq(attemptAnswers.attemptId, attempt.id))
    .all();
  const byQuestion = new Map(answers.map((a) => [a.questionId, a]));

  let autoScore = 0;
  let hasOpenText = false;

  db.transaction(() => {
    for (const q of qs) {
      const ans = byQuestion.get(q.id);
      const points = gradeAnswer(
        q,
        (ans?.selectedOptionIds as string[] | null) ?? null,
        ans?.answerText ?? null,
        attempt.id
      );
      if (points === null) {
        hasOpenText = true;
        continue;
      }
      autoScore += points;
      if (ans) {
        db.update(attemptAnswers).set({ autoPoints: points }).where(eq(attemptAnswers.id, ans.id)).run();
      }
    }

    const now = new Date();
    const status = hasOpenText ? "submitted" : "graded";
    const finalScore = hasOpenText ? null : autoScore;

    db.update(examAttempts)
      .set({
        submittedAt: now,
        autoScore,
        finalScore,
        status,
        gradedAt: hasOpenText ? null : now,
        updatedAt: now,
      })
      .where(eq(examAttempts.id, attempt.id))
      .run();

    // Completion ≠ Success: el ítem-examen se marca consumido al enviar
    const enrollment = getEnrollment(opts.courseId, opts.studentId);
    if (enrollment) {
      const ip = ensureItemProgress(enrollment.id, attempt.examItemId);
      db.update(itemProgress)
        .set({
          status: "completed",
          percent: 100,
          completedAt: ip.completedAt ?? now,
          lastActivityAt: now,
          updatedAt: now,
        })
        .where(eq(itemProgress.id, ip.id))
        .run();
    }
  });

  // Evaluación de reglas fuera de la transacción (evento: score publicado)
  const enrollment = getEnrollment(opts.courseId, opts.studentId);
  if (enrollment && !hasOpenText) evaluateEnrollment(enrollment.id);

  // Con preguntas abiertas: avisar al maestro que hay calificación pendiente
  if (hasOpenText) {
    const item = db.select().from(courseItems).where(eq(courseItems.id, attempt.examItemId)).get();
    const course = item
      ? db.select().from(courses).where(eq(courses.id, item.courseId)).get()
      : null;
    if (course) {
      notify(course.ownerId, "exam_needs_grading", {
        courseId: course.id,
        courseTitle: course.title,
        itemId: attempt.examItemId,
        itemTitle: item!.title,
        studentId: opts.studentId,
        attemptId: attempt.id,
      });
    }
  }

  return db.select().from(examAttempts).where(eq(examAttempts.id, opts.attemptId)).get()!;
}
