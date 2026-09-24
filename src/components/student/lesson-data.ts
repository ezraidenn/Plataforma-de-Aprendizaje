import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { attemptAnswers } from "@/server/db/schema";
import {
  getAssignmentDetail,
  listAssignmentAttachments,
  listSubmissionFiles,
  listStudentSubmissions,
  type AssignmentSubmission,
} from "@/server/services/assignments";
import { getLink, listResourceFiles, type FileEntry } from "@/server/services/resources";
import {
  getExam,
  listQuestions,
  listAttempts,
  examWindowState,
  imageItemToken,
  imageZoneToken,
  matchingToken,
  orderingToken,
  type ExamAttempt,
} from "@/server/services/exams";
import { getVideoDetail, getVideoProgress } from "@/server/services/video";
import { resultsVisible } from "@/lib/exam-results";
import { shuffledOrder } from "@/lib/ordering";
import { dragCopies, readImageClick, readImageDrag } from "@/lib/image-questions";
import type {
  AssignmentLessonData,
  AttemptDto,
  DownloadableFile,
  ExamLessonData,
  LinkLessonData,
  ResourceLessonData,
  PastAttempt,
  RunnerQuestion,
  SavedAnswer,
  SubmissionDto,
  VideoLessonData,
} from "./types";

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function attemptToDto(a: ExamAttempt): AttemptDto {
  return {
    id: a.id,
    attemptNumber: a.attemptNumber,
    status: a.status,
    startedAtMs: a.startedAt.getTime(),
    deadlineAtMs: a.deadlineAt?.getTime() ?? null,
    questionOrder: (a.questionOrder as string[] | null) ?? [],
  };
}

/** Respuestas guardadas de un intento, serializables para el cliente. */
export function answersForAttempt(attemptId: string): SavedAnswer[] {
  return db
    .select()
    .from(attemptAnswers)
    .where(eq(attemptAnswers.attemptId, attemptId))
    .all()
    .map((r) => ({
      questionId: r.questionId,
      selectedOptionIds: (r.selectedOptionIds as string[] | null) ?? null,
      answerText: r.answerText,
    }));
}

/**
 * Preguntas del intento para el ExamRunner: SOLO las sorteadas en el
 * questionOrder del intento, en ese orden. Viajan SIN isCorrect ni respuestas
 * aceptadas; el matching baraja las derechas identificadas por un token opaco
 * por intento (formato de respuesta {leftIndex: token}). El banco completo
 * nunca sale del servidor.
 */
export function buildRunnerQuestions(attempt: ExamAttempt): RunnerQuestion[] {
  const qs = listQuestions(attempt.examItemId);
  const byId = new Map(qs.map((q) => [q.id, q]));
  const order = (attempt.questionOrder as string[] | null) ?? qs.map((q) => q.id);

  const out: RunnerQuestion[] = [];
  for (const qid of order) {
    const q = byId.get(qid);
    if (!q) continue;
    const withOptions =
      q.type === "single_choice" || q.type === "multiple_choice" || q.type === "true_false";
    let matching: RunnerQuestion["matching"] = null;
    if (q.type === "matching") {
      const pairs =
        (q.config as { pairs?: { left: string; right: string }[] } | null)?.pairs ?? [];
      matching = {
        lefts: pairs.map((p) => p.left),
        rights: shuffle(
          pairs.map((p, i) => ({ token: matchingToken(attempt.id, q.id, i), text: p.right }))
        ),
      };
    }
    let ordering: RunnerQuestion["ordering"] = null;
    if (q.type === "ordering") {
      const steps = (q.config as { steps?: string[] } | null)?.steps ?? [];
      ordering = {
        steps: shuffledOrder(steps.length).map((i) => ({
          token: orderingToken(attempt.id, q.id, i),
          text: steps[i],
        })),
      };
    }
    // Preguntas sobre imagen: viajan las posiciones de los lugares y las fichas,
    // nunca qué elemento va en cada lugar ni dónde están los puntos correctos
    let image: string | null = null;
    let imageDrag: RunnerQuestion["imageDrag"] = null;
    let imageClick: RunnerQuestion["imageClick"] = null;
    const drag = q.type === "image_drag" ? readImageDrag(q) : null;
    if (drag) {
      const c = drag.config;
      image = drag.image;
      imageDrag = {
        aspect: c.aspect,
        iconSize: c.iconSize,
        // Revueltos: el orden no puede delatar a qué elemento pertenece cada lugar
        zones: shuffle(c.zones.map((z) => ({ token: imageZoneToken(attempt.id, q.id, z), x: z.x, y: z.y }))),
        items: shuffle(
          dragCopies(c).map((cp) => {
            const e = c.elements[cp.elementIndex];
            return {
              token: imageItemToken(attempt.id, q.id, cp.elementId, cp.copy),
              kind: e.kind,
              text: e.text,
              fileId: e.fileId,
            };
          })
        ),
      };
    }
    const click = q.type === "image_click" ? readImageClick(q) : null;
    if (click) {
      image = click.image;
      imageClick = { aspect: click.config.aspect, marks: click.config.spots.length };
    }
    out.push({
      id: q.id,
      type: q.type,
      promptMd: q.promptMd,
      points: q.points,
      options: withOptions ? q.options.map((o) => ({ id: o.id, text: o.textMd })) : [],
      matching,
      ordering,
      image,
      imageDrag,
      imageClick,
    });
  }
  return out;
}

/**
 * Datos del examen para el ExamRunner. Las preguntas NO viajan a nivel raíz:
 * solo dentro de `resume` (intento en curso) o en la respuesta de
 * startAttemptAction al iniciar.
 */
export function buildExamLessonData(
  itemId: string,
  studentId: string
): ExamLessonData | { kind: "exam-unavailable" } {
  const exam = getExam(itemId);
  if (!exam) return { kind: "exam-unavailable" };

  const now = Date.now();
  const qs = listQuestions(itemId);

  const attempts = listAttempts(itemId, studentId);
  const finished = attempts.filter((a) => a.status !== "in_progress");

  // El % solo viaja cuando el alumno ya puede ver sus resultados (regla única)
  const visible = resultsVisible(exam, now);
  const pastAttempts: PastAttempt[] = finished.map((a) => ({
    number: a.attemptNumber,
    status: a.status === "graded" ? "graded" : "submitted",
    submittedAtMs: a.submittedAt?.getTime() ?? null,
    percent:
      visible && a.status === "graded" && a.finalScore !== null && a.maxScoreSnapshot
        ? Math.round((a.finalScore / a.maxScoreSnapshot) * 1000) / 10
        : null,
  }));

  const open = attempts.find(
    (a) => a.status === "in_progress" && (!a.deadlineAt || a.deadlineAt.getTime() > now)
  );

  // Con pool aleatorio, cada intento tiene drawCount preguntas (no el banco)
  const questionCount =
    exam.drawCount && exam.drawCount > 0 && exam.drawCount < qs.length
      ? exam.drawCount
      : qs.length;

  return {
    kind: "exam",
    instructionsMd: exam.instructionsMd,
    questionCount,
    timeLimitMinutes: exam.timeLimitMinutes,
    passScore: exam.passScore,
    maxAttempts: exam.maxAttempts,
    scorePolicy: exam.attemptScorePolicy,
    showResultsMode: exam.showResultsMode,
    resultsVisible: visible,
    opensAtMs: exam.opensAt?.getTime() ?? null,
    closesAtMs: exam.closesAt?.getTime() ?? null,
    windowState: examWindowState(exam, now),
    attemptsUsed: finished.length,
    pastAttempts,
    resume: open
      ? {
          attempt: attemptToDto(open),
          answers: answersForAttempt(open.id),
          questions: buildRunnerQuestions(open),
        }
      : null,
    serverNowMs: now,
  };
}

/** Serializa una entrega para el cliente, resolviendo el nombre del archivo. */
export function submissionToDto(s: AssignmentSubmission): SubmissionDto {
  const all = listSubmissionFiles(s);
  return {
    id: s.id,
    fileId: all[0]?.fileId ?? null,
    fileName: all[0]?.originalName ?? "",
    files: all.map((f) => ({ fileId: f.fileId, name: f.originalName, sizeBytes: f.sizeBytes })),
    answerText: s.answerText,
    comment: s.comment,
    submittedAtMs: s.submittedAt.getTime(),
    isLate: s.isLate,
    status: s.status,
    score: s.score,
    feedbackMd: s.feedbackMd,
  };
}

/**
 * Datos de la tarea para AssignmentView: detalle + entrega más reciente del
 * alumno (DISENO-UX §2.6). La fecha límite viaja en ms y se compara contra el
 * reloj del servidor; el servicio vuelve a validar todo al entregar.
 */
export function buildAssignmentLessonData(
  itemId: string,
  studentId: string
): AssignmentLessonData | { kind: "assignment-unavailable" } {
  const assignment = getAssignmentDetail(itemId);
  if (!assignment) return { kind: "assignment-unavailable" };

  const submissions = listStudentSubmissions(itemId, studentId);
  const latest = submissions[0] ?? null;

  return {
    kind: "assignment",
    instructionsMd: assignment.instructionsMd,
    attachments: listAssignmentAttachments(itemId).map(toDownloadable),
    dueAtMs: assignment.dueAt?.getTime() ?? null,
    maxScore: assignment.maxScore,
    allowedFileTypes: assignment.allowedFileTypes,
    allowResubmission: assignment.allowResubmission,
    allowLate: assignment.allowLate,
    latest: latest ? submissionToDto(latest) : null,
    serverNowMs: Date.now(),
  };
}

function toDownloadable(f: FileEntry): DownloadableFile {
  return { fileId: f.fileId, name: f.originalName, mimeType: f.mimeType, sizeBytes: f.sizeBytes };
}

/** Enlace externo: URL + descripción; sin URL el visor muestra "en preparación". */
export function buildLinkLessonData(
  itemId: string,
  initialCompleted: boolean
): LinkLessonData | { kind: "link-unavailable" } {
  const link = getLink(itemId);
  if (!link || !link.url.trim()) return { kind: "link-unavailable" };
  return { kind: "link", url: link.url, description: link.description, initialCompleted };
}

/** Recurso descargable: lista de archivos (puede estar vacía). */
export function buildResourceLessonData(
  itemId: string,
  initialCompleted: boolean
): ResourceLessonData {
  return {
    kind: "resource",
    files: listResourceFiles(itemId).map(toDownloadable),
    initialCompleted,
  };
}

/** Datos del video para el VideoPlayer (reanudar + frontera de seek). */
export function buildVideoLessonData(
  courseId: string,
  studentId: string,
  itemId: string
): VideoLessonData | { kind: "video-unavailable" } {
  const video = getVideoDetail(itemId);
  if (!video || !video.videoId || video.provider === "other") {
    return { kind: "video-unavailable" };
  }
  const prog = getVideoProgress(courseId, studentId, itemId) ?? {
    percent: 0,
    completed: false,
    lastPosition: 0,
    maxPosition: 0,
  };
  return {
    kind: "video",
    provider: video.provider,
    videoId: video.videoId,
    durationSeconds: video.durationSeconds,
    allowSpeedUp: video.allowSpeedUp,
    initialPercent: prog.completed ? 100 : Math.round(prog.percent),
    initialCompleted: prog.completed,
    lastPosition: prog.lastPosition,
    maxPosition: prog.maxPosition,
  };
}
