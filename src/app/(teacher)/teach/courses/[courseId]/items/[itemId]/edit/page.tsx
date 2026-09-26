import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronRight, FileQuestion } from "lucide-react";
import { requireTeacher } from "@/server/auth/guards";
import { getOwnedCourse } from "@/server/services/courses";
import { getItem } from "@/server/services/tree";
import { getExam, listQuestions } from "@/server/services/exams";
import { questionsAnsweredInProgress, studentsWithAttempts } from "@/server/services/exam-results";
import { isImageQuestionType } from "@/lib/image-questions";
import { ExamSettingsCard } from "@/components/teach/exam/exam-settings-card";
import { QuestionList, type QuestionData } from "@/components/teach/exam/question-list";
import { ExamCsvActions } from "@/components/teach/bulk/exam-csv-dialog";
import { AiImportDialog } from "@/components/teach/exam/ai-import-dialog";
import { PreviewButton } from "@/components/teach/exam/preview-button";
import { getAiSettings } from "@/server/services/ai-settings";

export const metadata: Metadata = { title: "Editor de examen" };

export default async function ExamEditPage({
  params,
}: {
  params: Promise<{ courseId: string; itemId: string }>;
}) {
  const user = await requireTeacher();
  const { courseId, itemId } = await params;

  const course = getOwnedCourse(courseId, user);
  if (!course) notFound();

  // El ítem debe existir, pertenecer a este curso y ser un examen
  const item = getItem(itemId);
  if (!item || item.courseId !== courseId || item.kind !== "exam") notFound();

  const exam = getExam(itemId);
  if (!exam) notFound();

  const rawQuestions = listQuestions(itemId);
  const questions: QuestionData[] = rawQuestions.map((q) => {
    const config = (q.config ?? {}) as {
      accepted?: string[];
      pairs?: { left: string; right: string }[];
      steps?: string[];
    };
    return {
      id: q.id,
      type: q.type,
      promptMd: q.promptMd,
      points: q.points,
      options: q.options.map((o) => ({ textMd: o.textMd, isCorrect: o.isCorrect })),
      accepted: Array.isArray(config.accepted) ? config.accepted : [],
      pairs: Array.isArray(config.pairs) ? config.pairs : [],
      steps: Array.isArray(config.steps) ? config.steps : [],
      imageFileId: q.imageFileId,
      imageConfig: isImageQuestionType(q.type) ? q.config : null,
    };
  });
  // La IA nunca crea preguntas sobre imagen; "reemplazar" solo borra las demás
  const imageQuestionCount = rawQuestions.filter((q) => isImageQuestionType(q.type)).length;
  // Alumnos con un intento enviado: la publicación de resultados y el editor de fotos (cambiar una foto cambia sus revisiones)
  const attempted = studentsWithAttempts(itemId);
  // Y las preguntas que alguien ya respondió en un intento en curso (su foto también pide confirmación)
  const answeredInProgress = questionsAnsweredInProgress(itemId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-section-soft text-section-strong">
            <FileQuestion className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <nav
              aria-label="Miga de pan del examen"
              className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.14em] text-section-strong"
            >
              <Link
                href={`/teach/courses/${courseId}/content?item=${itemId}`}
                className="inline-flex items-center gap-1 transition-colors hover:underline"
              >
                <ArrowLeft className="size-3.5" aria-hidden />
                Contenido
              </Link>
              <ChevronRight className="size-3" aria-hidden />
              <span>Editor de examen</span>
            </nav>
            <h2 aria-current="page" className="truncate font-heading text-lg font-semibold leading-tight">
              {item.title}
            </h2>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PreviewButton courseId={courseId} itemId={itemId} disabled={questions.length === 0} />
          {getAiSettings().configured && (
            <AiImportDialog
              courseId={courseId}
              itemId={itemId}
              currentCount={questions.length - imageQuestionCount}
              imageCount={imageQuestionCount}
            />
          )}
          <ExamCsvActions itemId={itemId} questionCount={questions.length} imageCount={imageQuestionCount} />
        </div>
      </div>

      <ExamSettingsCard
        courseId={courseId}
        itemId={itemId}
        questionCount={questions.length}
        settings={{
          instructionsMd: exam.instructionsMd,
          opensAtMs: exam.opensAt?.getTime() ?? null,
          closesAtMs: exam.closesAt?.getTime() ?? null,
          maxAttempts: exam.maxAttempts,
          attemptScorePolicy: exam.attemptScorePolicy,
          timeLimitMinutes: exam.timeLimitMinutes,
          passScore: exam.passScore,
          shuffleQuestions: exam.shuffleQuestions,
          showResultsMode: exam.showResultsMode,
          drawCount: exam.drawCount,
          resultsPublishedAtMs: exam.resultsPublishedAt?.getTime() ?? null,
          resultsVisibleByClose:
            exam.showResultsMode === "after_close" &&
            exam.closesAt !== null &&
            exam.closesAt.getTime() <= Date.now(),
          studentsWithAttempts: attempted,
        }}
      />

      <QuestionList
        courseId={courseId}
        itemId={itemId}
        questions={questions}
        drawCount={exam.drawCount}
        hasAttempts={attempted > 0}
        answeredInProgress={answeredInProgress}
      />
    </div>
  );
}
