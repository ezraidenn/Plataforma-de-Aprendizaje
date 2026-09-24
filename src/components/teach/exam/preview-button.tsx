"use client";

import { useState, useTransition } from "react";
import { Eye, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ExamPreview } from "@/components/exam/exam-preview";
import { keepOpenWhileChoosing } from "@/components/exam/image-dnd";
import { examPreviewAction } from "@/server/actions/ai-exam";
import type { PreviewQuestion } from "@/lib/preview-question";

/** «Ver como alumno»: el examen guardado tal como lo verá el estudiante. */
export function PreviewButton({
  courseId,
  itemId,
  disabled,
}: {
  courseId: string;
  itemId: string;
  disabled?: boolean;
}) {
  const [questions, setQuestions] = useState<PreviewQuestion[] | null>(null);
  const [loading, startLoading] = useTransition();

  function open() {
    startLoading(async () => {
      const result = await examPreviewAction({ courseId, itemId });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setQuestions(result.questions);
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="h-11"
        onClick={open}
        disabled={disabled || loading}
        title={disabled ? "Aún no hay preguntas" : undefined}
      >
        {loading ? <Loader2 className="animate-spin" aria-hidden /> : <Eye aria-hidden />}
        Ver como alumno
      </Button>
      <PreviewDialog
        questions={questions}
        onClose={() => setQuestions(null)}
        description="Así verá el estudiante este examen. Puedes contestar y moverte libremente."
      />
    </>
  );
}

/** El diálogo «Ver como alumno»: abierto mientras haya preguntas. */
export function PreviewDialog({
  questions,
  onClose,
  description,
}: {
  questions: PreviewQuestion[] | null;
  onClose: () => void;
  description: string;
}) {
  return (
    <Dialog open={questions !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="flex h-[88vh] flex-col gap-3 overflow-hidden sm:max-w-4xl"
        // Con una ficha elegida en una pregunta sobre imagen, Esc solo la suelta
        onEscapeKeyDown={keepOpenWhileChoosing}
      >
        <DialogHeader>
          <DialogTitle>Ver como alumno</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1">{questions && <ExamPreview questions={questions} onClose={onClose} />}</div>
      </DialogContent>
    </Dialog>
  );
}
