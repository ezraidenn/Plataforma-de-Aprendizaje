"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { sendTestMailAction } from "@/server/actions/admin-mail";

export function TestMailButton({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function send() {
    startTransition(async () => {
      const result = await sendTestMailAction();
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success(result.message);
        // El envío tarda unos segundos: se refresca la lista después
        setTimeout(() => router.refresh(), 6000);
      }
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={send} disabled={pending || disabled}>
      <Send aria-hidden />
      {pending ? "Enviando…" : "Enviarme un correo de prueba"}
    </Button>
  );
}
