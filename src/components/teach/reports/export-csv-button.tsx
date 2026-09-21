"use client";

import { useTransition } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { downloadTextFile, slugifyFilename } from "@/components/teach/csv-download";
import { exportMatrixCsvAction } from "@/server/actions/teacher-reports";
import type { MatrixFilterValue } from "./filter-tabs";

/** Exporta EL FILTRO ACTUAL de la matriz como CSV (DISENO-UX §2.11). */
export function ExportCsvButton({
  courseId,
  courseTitle,
  search,
  filter,
  grupo,
}: {
  courseId: string;
  courseTitle: string;
  search: string;
  filter: MatrixFilterValue;
  /** Filtro de grupo de la URL (`?grupo=`); vacío = grupos abiertos. */
  grupo?: string;
}) {
  const [pending, startTransition] = useTransition();

  function handleExport() {
    startTransition(async () => {
      const result = await exportMatrixCsvAction(courseId, { search, filter, grupo });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      downloadTextFile(`progreso-${slugifyFilename(courseTitle)}.csv`, result.csv);
      toast.success("CSV descargado");
    });
  }

  return (
    <Button
      variant="outline"
      className="h-11"
      onClick={handleExport}
      disabled={pending}
    >
      {pending ? (
        <Loader2 className="animate-spin" aria-hidden />
      ) : (
        <Download aria-hidden />
      )}
      {pending ? "Generando…" : "Exportar CSV"}
    </Button>
  );
}
