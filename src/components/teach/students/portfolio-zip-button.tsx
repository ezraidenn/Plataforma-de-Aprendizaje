"use client";

import { FolderArchive } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** Descarga el portafolio completo (ZIP de certificados vigentes) del estudiante. */
export function PortfolioZipButton({
  studentId,
  disabled,
}: {
  studentId: string;
  disabled: boolean;
}) {
  return (
    <Button
      className="h-11 bg-cta text-cta-foreground hover:bg-cta/90"
      disabled={disabled}
      onClick={() => {
        toast.info("Preparando el portafolio…");
        window.location.assign(`/api/certificates/zip?studentId=${studentId}`);
      }}
    >
      <FolderArchive className="size-4" aria-hidden />
      Descargar portafolio (ZIP)
    </Button>
  );
}
