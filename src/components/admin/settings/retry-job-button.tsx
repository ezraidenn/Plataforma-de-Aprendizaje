"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { adminRetryJobAction } from "@/server/actions/admin-jobs";

/** Vuelve a poner en cola un trabajo con error; solo se muestra en filas con error. */
export function RetryJobButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function retry() {
    startTransition(async () => {
      const result = await adminRetryJobAction(jobId);
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success("El trabajo volvió a la cola");
        router.refresh();
      }
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={retry} disabled={pending}>
      <RefreshCw className={pending ? "animate-spin" : undefined} aria-hidden />
      {pending ? "Enviando…" : "Reintentar"}
    </Button>
  );
}
