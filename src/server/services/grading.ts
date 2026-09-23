import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { ownerCondition, type ViewScope } from "@/server/auth/view-scope";
import {
  examAttempts,
  attemptAnswers,
  questions,
  courseItems,
  courses,
  assignmentSubmissions,
  itemAssignments,
  certificates,
  users,
  enrollments,
  exams,
} from "@/server/db/schema";
import { resultsVisible } from "@/lib/exam-results";
import { evaluateEnrollment } from "./rules-engine";
import { notify } from "./notifications";
import { audit } from "./audit";

type ExamAttempt = typeof examAttempts.$inferSelect;

// ─── Cola de calificación ────────────────────────────────────────────────────

/**
 * Lo que solo tiene sentido en lo YA calificado (`gradedRecently`). En la cola
 * de pendientes viene vacío, así que quien ya usaba `GradingQueueEntry` no se
 * entera de que existe.
 */
type GradedInfo = {
  /** Nota puesta (examen: final_score; tarea: score). */
  score?: number | null;
  /** Sobre cuánto (examen: máximo del intento; tarea: puntos de la tarea). */
  maxScore?: number | null;
  gradedAt?: Date | null;
  gradedByName?: string | null;
  /** Estado real de la fila: «graded», o «returned» en tareas devueltas. */
  status?: string;
};

export type GradingQueueEntry =
  | ({
      kind: "exam";
      attemptId: string;
      courseId: string;
      courseTitle: string;
      itemId: string;
      itemTitle: string;
      studentId: string;
      studentName: string;
      submittedAt: Date;
      pendingQuestions: number;
    } & GradedInfo)
  | ({
      kind: "assignment";
      submissionId: string;
      courseId: string;
      courseTitle: string;
      itemId: string;
      itemTitle: string;
      studentId: string;
      studentName: string;
      submittedAt: Date;
      isLate: boolean;
    } & GradedInfo);

/** Cola global del maestro, ordenada por antigüedad (lo más viejo primero). */
export function gradingQueue(scope: ViewScope): GradingQueueEntry[] {
  const ownerFilter = (ownerId: typeof courses.ownerId) => ownerCondition(scope, ownerId) ?? sql`1=1`;

  const attempts = db
    .select({
      attemptId: examAttempts.id,
      courseId: courses.id,
      courseTitle: courses.title,
      itemId: courseItems.id,
      itemTitle: courseItems.title,
      studentId: users.id,
      studentName: users.fullName,
      submittedAt: examAttempts.submittedAt,
    })
    .from(examAttempts)
    .innerJoin(courseItems, eq(examAttempts.examItemId, courseItems.id))
    .innerJoin(courses, eq(courseItems.courseId, courses.id))
    .innerJoin(users, eq(examAttempts.studentId, users.id))
    .where(and(eq(examAttempts.status, "submitted"), ownerFilter(courses.ownerId)))
    .all();

  // Pendientes por intento = abiertas SORTEADAS sin calificar. Contar solo
  // filas de attempt_answers subcontaba: una abierta sin responder no tiene
  // fila, pero igual debe calificarse (con 0 o los puntos que decida el
  // maestro).
  const attemptIds = attempts.map((a) => a.attemptId);
  const pendingByAttempt = new Map<string, number>();
  if (attemptIds.length > 0) {
    const fullAttempts = db
      .select({ id: examAttempts.id, examItemId: examAttempts.examItemId, questionOrder: examAttempts.questionOrder })
      .from(examAttempts)
      .where(inArray(examAttempts.id, attemptIds))
      .all();
    const openByExam = new Map<string, string[]>();
    for (const a of fullAttempts) {
      if (!openByExam.has(a.examItemId)) {
        openByExam.set(
          a.examItemId,
          db
            .select({ id: questions.id })
            .from(questions)
            .where(and(eq(questions.examItemId, a.examItemId), eq(questions.type, "open_text")))
            .all()
            .map((q) => q.id)
        );
      }
    }
    const gradedRows = db
      .select({ attemptId: attemptAnswers.attemptId, questionId: attemptAnswers.questionId })
      .from(attemptAnswers)
      .where(
        and(inArray(attemptAnswers.attemptId, attemptIds), sql`${attemptAnswers.manualPoints} IS NOT NULL`)
      )
      .all();
    const gradedByAttempt = new Map<string, Set<string>>();
    for (const r of gradedRows) {
      if (!gradedByAttempt.has(r.attemptId)) gradedByAttempt.set(r.attemptId, new Set());
      gradedByAttempt.get(r.attemptId)!.add(r.questionId);
    }
    for (const a of fullAttempts) {
      const drawn = a.questionOrder ? new Set(a.questionOrder as string[]) : null;
      const openDrawn = (openByExam.get(a.examItemId) ?? []).filter(
        (qid) => !drawn || drawn.has(qid)
      );
      const graded = gradedByAttempt.get(a.id) ?? new Set();
      pendingByAttempt.set(a.id, openDrawn.filter((qid) => !graded.has(qid)).length);
    }
  }

  const submissions = db
    .select({
      submissionId: assignmentSubmissions.id,
      courseId: courses.id,
      courseTitle: courses.title,
      itemId: courseItems.id,
      itemTitle: courseItems.title,
      studentId: users.id,
      studentName: users.fullName,
      submittedAt: assignmentSubmissions.submittedAt,
      isLate: assignmentSubmissions.isLate,
    })
    .from(assignmentSubmissions)
    .innerJoin(courseItems, eq(assignmentSubmissions.itemId, courseItems.id))
    .innerJoin(courses, eq(courseItems.courseId, courses.id))
    .innerJoin(users, eq(assignmentSubmissions.studentId, users.id))
    .where(and(eq(assignmentSubmissions.status, "submitted"), ownerFilter(courses.ownerId)))
    .all();

  const entries: GradingQueueEntry[] = [
    ...attempts.map((a) => ({
      kind: "exam" as const,
      ...a,
      submittedAt: a.submittedAt!,
      pendingQuestions: pendingByAttempt.get(a.attemptId) ?? 0,
    })),
    ...submissions.map((s) => ({ kind: "assignment" as const, ...s })),
  ];

  return entries.sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime());
}

// ─── Lo ya calificado ────────────────────────────────────────────────────────

/** Nombre de quien calificó, para varias filas de golpe (una consulta). */
function graderNames(ids: (string | null)[]): Map<string, string> {
  const list = [...new Set(ids.filter((id): id is string => !!id))];
  if (list.length === 0) return new Map();
  return new Map(
    db
      .select({ id: users.id, name: users.fullName })
      .from(users)
      .where(inArray(users.id, list))
      .all()
      .map((u) => [u.id, u.name])
  );
}

/** Máximo de un examen cuando el intento no guardó su copia (intentos viejos). */
function examMaxScores(itemIds: string[]): Map<string, number> {
  const list = [...new Set(itemIds)];
  if (list.length === 0) return new Map();
  return new Map(
    db
      .select({ itemId: questions.examItemId, total: sql<number>`COALESCE(SUM(${questions.points}), 0)` })
      .from(questions)
      .where(inArray(questions.examItemId, list))
      .groupBy(questions.examItemId)
      .all()
      .map((r) => [r.itemId, r.total])
  );
}

/**
 * Lo que YA se calificó, de lo más reciente a lo más viejo: exámenes
 * calificados y tareas calificadas o devueltas, con la nota puesta y quién la
 * puso. Es la lista que deja volver a abrir algo para corregirlo.
 */
export function gradedRecently(
  scope: ViewScope,
  opts: { limit?: number; courseId?: string } = {}
): GradingQueueEntry[] {
  const limit = Math.min(200, Math.max(1, Math.trunc(opts.limit ?? 50)));
  const ownerFilter = ownerCondition(scope, courses.ownerId);
  const courseFilter = opts.courseId ? eq(courses.id, opts.courseId) : undefined;

  const attempts = db
    .select({
      attemptId: examAttempts.id,
      courseId: courses.id,
      courseTitle: courses.title,
      itemId: courseItems.id,
      itemTitle: courseItems.title,
      studentId: users.id,
      studentName: users.fullName,
      submittedAt: examAttempts.submittedAt,
      gradedAt: examAttempts.gradedAt,
      gradedBy: examAttempts.gradedBy,
      score: examAttempts.finalScore,
      maxScore: examAttempts.maxScoreSnapshot,
      status: examAttempts.status,
    })
    .from(examAttempts)
    .innerJoin(courseItems, eq(examAttempts.examItemId, courseItems.id))
    .innerJoin(courses, eq(courseItems.courseId, courses.id))
    .innerJoin(users, eq(examAttempts.studentId, users.id))
    .where(and(eq(examAttempts.status, "graded"), ownerFilter, courseFilter))
    .orderBy(desc(examAttempts.gradedAt))
    .limit(limit)
    .all();

  const submissions = db
    .select({
      submissionId: assignmentSubmissions.id,
      courseId: courses.id,
      courseTitle: courses.title,
      itemId: courseItems.id,
      itemTitle: courseItems.title,
      studentId: users.id,
      studentName: users.fullName,
      submittedAt: assignmentSubmissions.submittedAt,
      isLate: assignmentSubmissions.isLate,
      gradedAt: assignmentSubmissions.gradedAt,
      gradedBy: assignmentSubmissions.gradedBy,
      score: assignmentSubmissions.score,
      maxScore: itemAssignments.maxScore,
      status: assignmentSubmissions.status,
    })
    .from(assignmentSubmissions)
    .innerJoin(courseItems, eq(assignmentSubmissions.itemId, courseItems.id))
    .innerJoin(courses, eq(courseItems.courseId, courses.id))
    .innerJoin(users, eq(assignmentSubmissions.studentId, users.id))
    .leftJoin(itemAssignments, eq(itemAssignments.itemId, assignmentSubmissions.itemId))
    .where(
      and(inArray(assignmentSubmissions.status, ["graded", "returned"]), ownerFilter, courseFilter)
    )
    .orderBy(desc(assignmentSubmissions.gradedAt))
    .limit(limit)
    .all();

  const names = graderNames([...attempts.map((a) => a.gradedBy), ...submissions.map((s) => s.gradedBy)]);
  const maxByExam = examMaxScores(attempts.filter((a) => a.maxScore === null).map((a) => a.itemId));

  const entries: GradingQueueEntry[] = [
    ...attempts.map((a) => ({
      kind: "exam" as const,
      attemptId: a.attemptId,
      courseId: a.courseId,
      courseTitle: a.courseTitle,
      itemId: a.itemId,
      itemTitle: a.itemTitle,
      studentId: a.studentId,
      studentName: a.studentName,
      // Un intento calificado siempre se envió; si faltara, vale la fecha de
      // calificación antes que una fecha inventada
      submittedAt: a.submittedAt ?? a.gradedAt ?? new Date(0),
      pendingQuestions: 0,
      score: a.score,
      maxScore: a.maxScore ?? maxByExam.get(a.itemId) ?? null,
      gradedAt: a.gradedAt,
      gradedByName: a.gradedBy ? (names.get(a.gradedBy) ?? null) : null,
      status: a.status,
    })),
    ...submissions.map((s) => ({
      kind: "assignment" as const,
      submissionId: s.submissionId,
      courseId: s.courseId,
      courseTitle: s.courseTitle,
      itemId: s.itemId,
      itemTitle: s.itemTitle,
      studentId: s.studentId,
      studentName: s.studentName,
      submittedAt: s.submittedAt,
      isLate: s.isLate,
      // Una devuelta puede no llevar nota (se devolvió sin calificar): manda
      // lo que hay en la base y `status` dice de qué se trata
      score: s.score,
      maxScore: s.maxScore ?? null,
      gradedAt: s.gradedAt,
      gradedByName: s.gradedBy ? (names.get(s.gradedBy) ?? null) : null,
      status: s.status,
    })),
  ];

  return entries
    .sort((a, b) => (b.gradedAt?.getTime() ?? 0) - (a.gradedAt?.getTime() ?? 0))
    .slice(0, limit);
}

// ─── Calificar y corregir: piezas comunes ────────────────────────────────────

/** Lo que devuelve calificar: si fue corrección, de qué nota a cuál y el aviso. */
export type RegradeInfo = {
  /** true si ya había una nota puesta: esto fue una corrección. */
  regraded: boolean;
  scoreBefore: number | null;
  scoreAfter: number | null;
  /** Texto para el maestro cuando el alumno ya completó el curso. */
  warning?: string;
};

export type GradeAttemptResult = RegradeInfo & { finalized: boolean };

/** La matrícula (ciclo) a la que pertenece lo calificado. */
function enrollmentIdFor(
  explicit: string | null,
  courseId: string,
  studentId: string
): string | undefined {
  return (
    explicit ??
    db
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(and(eq(enrollments.courseId, courseId), eq(enrollments.studentId, studentId)))
      .get()?.id
  );
}

/**
 * Corregir a la baja a alguien que ya terminó no le quita nada: el motor de
 * reglas NUNCA des-aprueba y el certificado emitido sigue valiendo. Pero el
 * maestro tiene que enterarse, así que se lo devolvemos por escrito. Se mide
 * ANTES de volver a evaluar las reglas: subir la nota y completar ahora mismo
 * no es «ya estaba completado».
 */
function completionWarning(enrollmentId: string | undefined): string | undefined {
  if (!enrollmentId) return undefined;
  const enrollment = db.select().from(enrollments).where(eq(enrollments.id, enrollmentId)).get();
  if (!enrollment) return undefined;

  const cert = db
    .select({ folio: certificates.folio })
    .from(certificates)
    .where(and(eq(certificates.enrollmentId, enrollmentId), eq(certificates.revoked, false)))
    .get();
  if (cert) {
    return `Este alumno ya completó el curso y tiene el certificado ${cert.folio}. La nota se corrigió, pero el certificado sigue siendo válido; si hay que anularlo, hazlo desde Certificados.`;
  }
  if (enrollment.status === "completed") {
    return "Este alumno ya completó el curso. La nota se corrigió, pero la matrícula sigue marcada como completada; si ya no debería estarlo, revísalo en el curso.";
  }
  return undefined;
}

// ─── Calificar examen (preguntas abiertas) ───────────────────────────────────

export type OpenAnswerForGrading = {
  answerId: string;
  questionId: string;
  promptMd: string;
  points: number;
  answerText: string | null;
  manualPoints: number | null;
  feedbackMd: string | null;
};

/**
 * Sirve igual para calificar por primera vez que para volver a abrir un
 * intento YA calificado: devuelve los puntos y los comentarios que tiene
 * puestos, que es lo que el maestro va a editar.
 */
export function attemptForGrading(attemptId: string) {
  const attempt = db.select().from(examAttempts).where(eq(examAttempts.id, attemptId)).get();
  if (!attempt) return null;

  const open = db
    .select({
      answerId: attemptAnswers.id,
      questionId: questions.id,
      promptMd: questions.promptMd,
      points: questions.points,
      answerText: attemptAnswers.answerText,
      manualPoints: attemptAnswers.manualPoints,
      feedbackMd: attemptAnswers.feedbackMd,
    })
    .from(attemptAnswers)
    .innerJoin(questions, eq(attemptAnswers.questionId, questions.id))
    .where(and(eq(attemptAnswers.attemptId, attemptId), eq(questions.type, "open_text")))
    .orderBy(asc(questions.position))
    .all();

  // Preguntas abiertas SIN respuesta del alumno (también deben calificarse: 0 o puntos).
  // Con pool aleatorio solo cuentan las preguntas sorteadas en este intento.
  const drawnIds = attempt.questionOrder ? new Set(attempt.questionOrder as string[]) : null;
  const answeredIds = new Set(open.map((o) => o.questionId));
  const unanswered = db
    .select()
    .from(questions)
    .where(and(eq(questions.examItemId, attempt.examItemId), eq(questions.type, "open_text")))
    .orderBy(asc(questions.position))
    .all()
    .filter((q) => !answeredIds.has(q.id) && (!drawnIds || drawnIds.has(q.id)))
    .map(
      (q): OpenAnswerForGrading => ({
        answerId: "",
        questionId: q.id,
        promptMd: q.promptMd,
        points: q.points,
        answerText: null,
        manualPoints: null,
        feedbackMd: null,
      })
    );

  return { attempt, openAnswers: [...open, ...unanswered] };
}

/** Puntos manuales y nota final del intento tal como están ahora en la base. */
function computeAttemptScore(attempt: ExamAttempt): {
  allGraded: boolean;
  manualScore: number;
  finalScore: number;
} {
  const drawnIds = attempt.questionOrder ? new Set(attempt.questionOrder as string[]) : null;
  const openQuestions = db
    .select()
    .from(questions)
    .where(and(eq(questions.examItemId, attempt.examItemId), eq(questions.type, "open_text")))
    .all()
    .filter((q) => !drawnIds || drawnIds.has(q.id));

  const answers = db
    .select()
    .from(attemptAnswers)
    .where(eq(attemptAnswers.attemptId, attempt.id))
    .all();
  const byQuestion = new Map(answers.map((a) => [a.questionId, a]));

  const allGraded = openQuestions.every((q) => byQuestion.get(q.id)?.manualPoints != null);
  const manualScore = openQuestions.reduce(
    (sum, q) => sum + (byQuestion.get(q.id)?.manualPoints ?? 0),
    0
  );
  return { allGraded, manualScore, finalScore: (attempt.autoScore ?? 0) + manualScore };
}

/** Escribe los puntos de UNA pregunta abierta (sin recalcular la nota final). */
function saveOpenGrade(
  attempt: ExamAttempt,
  grade: { questionId: string; points: number; feedbackMd?: string }
) {
  const existing = db
    .select()
    .from(attemptAnswers)
    .where(
      and(eq(attemptAnswers.attemptId, attempt.id), eq(attemptAnswers.questionId, grade.questionId))
    )
    .get();

  if (existing) {
    db.update(attemptAnswers)
      .set({ manualPoints: grade.points, feedbackMd: grade.feedbackMd ?? null, updatedAt: new Date() })
      .where(eq(attemptAnswers.id, existing.id))
      .run();
  } else {
    // El alumno dejó la pregunta sin responder: fila para registrar los puntos
    db.insert(attemptAnswers)
      .values({
        id: crypto.randomUUID(),
        attemptId: attempt.id,
        questionId: grade.questionId,
        manualPoints: grade.points,
        feedbackMd: grade.feedbackMd ?? null,
      })
      .run();
  }
}

/**
 * Califica (o corrige) varias preguntas abiertas de un intento y publica la
 * nota una sola vez: un solo aviso al alumno, un solo registro de auditoría y
 * una sola evaluación de las reglas aunque se toquen cinco preguntas.
 */
export function gradeOpenAnswers(opts: {
  gradedBy: string;
  attemptId: string;
  grades: { questionId: string; points: number; feedbackMd?: string }[];
}): GradeAttemptResult {
  const attempt = db.select().from(examAttempts).where(eq(examAttempts.id, opts.attemptId)).get();
  if (!attempt) throw new Error("Intento no encontrado");
  if (attempt.status === "in_progress") throw new Error("Este intento aún no se envía");

  // Validar TODO antes de escribir nada: si la tercera pregunta trae puntos
  // imposibles, las dos primeras tampoco deben guardarse
  for (const grade of opts.grades) {
    const question = db.select().from(questions).where(eq(questions.id, grade.questionId)).get();
    if (!question || question.examItemId !== attempt.examItemId)
      throw new Error("Pregunta no encontrada");
    if (!Number.isFinite(grade.points) || grade.points < 0 || grade.points > question.points)
      throw new Error(`Los puntos deben estar entre 0 y ${question.points}`);
  }

  for (const grade of opts.grades) saveOpenGrade(attempt, grade);

  return finalizeAttempt(attempt.id, opts.gradedBy);
}

/**
 * Guarda la calificación manual de una pregunta abierta. Cuando ya no queda
 * ninguna abierta sin puntos, publica el final_score, marca graded, notifica
 * al alumno y dispara el motor de reglas.
 */
export function gradeOpenAnswer(opts: {
  gradedBy: string;
  attemptId: string;
  questionId: string;
  points: number;
  feedbackMd?: string;
}): GradeAttemptResult {
  return gradeOpenAnswers({
    gradedBy: opts.gradedBy,
    attemptId: opts.attemptId,
    grades: [{ questionId: opts.questionId, points: opts.points, feedbackMd: opts.feedbackMd }],
  });
}

/**
 * Publica la nota del intento. Funciona las dos veces: la primera calificación
 * y la corrección de un intento que YA estaba «graded» (se recalculan
 * manual_score y final_score, se vuelve a firmar quién y cuándo, y se
 * re-evalúan las reglas del curso). Al corregir solo se vuelve a avisar al
 * alumno si la nota final cambió.
 */
function finalizeAttempt(attemptId: string, gradedBy: string): GradeAttemptResult {
  const attempt = db.select().from(examAttempts).where(eq(examAttempts.id, attemptId)).get()!;
  const wasGraded = attempt.status === "graded";
  const scoreBefore = wasGraded ? attempt.finalScore : null;

  const { allGraded, manualScore, finalScore } = computeAttemptScore(attempt);
  if (!allGraded) {
    return { finalized: false, regraded: false, scoreBefore, scoreAfter: scoreBefore };
  }

  const now = new Date();
  db.update(examAttempts)
    .set({ manualScore, finalScore, status: "graded", gradedBy, gradedAt: now, updatedAt: now })
    .where(eq(examAttempts.id, attemptId))
    .run();

  const item = db.select().from(courseItems).where(eq(courseItems.id, attempt.examItemId)).get();
  const course = item
    ? db.select({ title: courses.title }).from(courses).where(eq(courses.id, item.courseId)).get()
    : undefined;
  const student = db
    .select({ name: users.fullName })
    .from(users)
    .where(eq(users.id, attempt.studentId))
    .get();
  const changed = !wasGraded || finalScore !== scoreBefore;
  let warning: string | undefined;

  if (item) {
    const enrollmentId = enrollmentIdFor(attempt.enrollmentId, item.courseId, attempt.studentId);
    if (wasGraded) warning = completionWarning(enrollmentId);

    // Con resultados ocultos no se avisa: el aviso llega al publicarlos. Y al
    // corregir, solo si la nota final cambió: repetir el mismo número molesta.
    if (changed) {
      const exam = db.select().from(exams).where(eq(exams.itemId, item.id)).get();
      if (!exam || resultsVisible(exam, Date.now())) {
        notify(attempt.studentId, "grade_published", {
          courseId: item.courseId,
          itemId: item.id,
          itemTitle: item.title,
          attemptId,
        });
      }
    }
    // El intento sabe a qué ciclo pertenece: calificar tarde uno de 2026 no
    // debe re-evaluar el ciclo 2027
    if (enrollmentId) evaluateEnrollment(enrollmentId);
  }

  const detalleBase = {
    studentId: attempt.studentId,
    studentName: student?.name ?? null,
    courseId: item?.courseId ?? null,
    courseTitle: course?.title ?? null,
    itemId: attempt.examItemId,
    itemTitle: item?.title ?? null,
    maxScore: attempt.maxScoreSnapshot ?? null,
  };
  audit(
    gradedBy,
    wasGraded ? "regrade_exam" : "grade_exam",
    "exam_attempts",
    attemptId,
    wasGraded
      ? { ...detalleBase, scoreBefore, scoreAfter: finalScore }
      : { ...detalleBase, score: finalScore }
  );

  return { finalized: true, regraded: wasGraded, scoreBefore, scoreAfter: finalScore, warning };
}

// ─── Calificar tareas ────────────────────────────────────────────────────────

/**
 * Califica, corrige o devuelve una entrega. Corregir una nota ya puesta guarda
 * la nueva, firma quién y cuándo, vuelve a evaluar las reglas del curso y
 * avisa al alumno solo si la nota cambió. Devolver sin calificar sigue igual
 * que siempre.
 */
export function gradeSubmission(opts: {
  gradedBy: string;
  submissionId: string;
  score: number;
  feedbackMd?: string;
  action: "grade" | "return";
}): RegradeInfo {
  const submission = db
    .select()
    .from(assignmentSubmissions)
    .where(eq(assignmentSubmissions.id, opts.submissionId))
    .get();
  if (!submission) throw new Error("Entrega no encontrada");

  const now = new Date();
  const item = db.select().from(courseItems).where(eq(courseItems.id, submission.itemId)).get();
  const enrollmentId = item
    ? enrollmentIdFor(submission.enrollmentId, item.courseId, submission.studentId)
    : undefined;

  if (opts.action === "return") {
    db.update(assignmentSubmissions)
      .set({
        status: "returned",
        feedbackMd: opts.feedbackMd ?? null,
        gradedBy: opts.gradedBy,
        gradedAt: now,
        updatedAt: now,
      })
      .where(eq(assignmentSubmissions.id, opts.submissionId))
      .run();
    notify(submission.studentId, "submission_returned", {
      itemId: submission.itemId,
      submissionId: submission.id,
    });
    return { regraded: false, scoreBefore: submission.score, scoreAfter: null };
  }

  const wasGraded = submission.status === "graded";
  const scoreBefore = wasGraded ? submission.score : null;
  const changed = !wasGraded || opts.score !== scoreBefore;
  // Se mide antes de re-evaluar las reglas (ver completionWarning)
  const warning = wasGraded ? completionWarning(enrollmentId) : undefined;

  db.update(assignmentSubmissions)
    .set({
      status: "graded",
      score: opts.score,
      feedbackMd: opts.feedbackMd ?? null,
      gradedBy: opts.gradedBy,
      gradedAt: now,
      updatedAt: now,
    })
    .where(eq(assignmentSubmissions.id, opts.submissionId))
    .run();

  if (changed) {
    notify(submission.studentId, "grade_published", {
      itemId: submission.itemId,
      submissionId: submission.id,
    });
  }

  if (enrollmentId) evaluateEnrollment(enrollmentId);

  const course = item
    ? db.select({ title: courses.title }).from(courses).where(eq(courses.id, item.courseId)).get()
    : undefined;
  const student = db
    .select({ name: users.fullName })
    .from(users)
    .where(eq(users.id, submission.studentId))
    .get();
  const maxScore = db
    .select({ max: itemAssignments.maxScore })
    .from(itemAssignments)
    .where(eq(itemAssignments.itemId, submission.itemId))
    .get()?.max;
  const detalleBase = {
    studentId: submission.studentId,
    studentName: student?.name ?? null,
    courseId: item?.courseId ?? null,
    courseTitle: course?.title ?? null,
    itemId: submission.itemId,
    itemTitle: item?.title ?? null,
    maxScore: maxScore ?? null,
  };
  audit(
    opts.gradedBy,
    wasGraded ? "regrade_assignment" : "grade_assignment",
    "assignment_submissions",
    submission.id,
    wasGraded
      ? { ...detalleBase, scoreBefore, scoreAfter: opts.score }
      : { ...detalleBase, score: opts.score }
  );

  return { regraded: wasGraded, scoreBefore, scoreAfter: opts.score, warning };
}
