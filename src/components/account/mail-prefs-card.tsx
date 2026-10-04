"use client";

import { useState, useTransition } from "react";
import { Mail } from "lucide-react";
import { toast } from "sonner";
import { setMailPrefAction } from "@/server/actions/account";
import type { MailPref } from "@/server/services/profile";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

const LABELS: Record<MailPref, { title: string; hint: string }> = {
  mailReminders: {
    title: "Pendientes que cierran pronto",
    hint: "Exámenes y tareas que vencen en 48 horas. Como máximo un correo al día.",
  },
  mailExpiry: { title: "Certificados por vencer", hint: "Un aviso 30 días antes de que venza un certificado." },
  mailNotices: { title: "Avisos de tus instructores", hint: "Cuando tu instructor manda un aviso también por correo." },
  mailDigest: {
    title: "Resumen del día",
    hint: "A las 7:00, lo que tienes por calificar, quién terminó y qué certificados vencen. Solo los días con algo.",
  },
};

export function MailPrefsCard({
  prefs,
  available,
  className,
}: {
  prefs: Record<MailPref, boolean>;
  available: readonly MailPref[];
  className?: string;
}) {
  const [state, setState] = useState(prefs);
  const [, startTransition] = useTransition();

  function toggle(pref: MailPref, on: boolean) {
    setState((s) => ({ ...s, [pref]: on }));
    startTransition(async () => {
      const result = await setMailPrefAction(pref, on);
      if ("error" in result) {
        setState((s) => ({ ...s, [pref]: !on }));
        toast.error(result.error);
      }
    });
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-heading text-base">
          <span className="flex size-7 items-center justify-center rounded-md bg-section-soft text-section-strong">
            <Mail className="size-4" aria-hidden />
          </span>
          Avisos por correo
        </CardTitle>
        <CardDescription>
          Los correos de tu cuenta (bienvenida, contraseña, inscripciones y certificados) siempre llegan. Estos
          puedes apagarlos:
        </CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        {available.map((pref) => (
          <div key={pref} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
            <div className="space-y-0.5">
              <Label htmlFor={`pref-${pref}`} className="text-sm font-medium">
                {LABELS[pref].title}
              </Label>
              <p className="text-xs text-muted-foreground">{LABELS[pref].hint}</p>
            </div>
            <Switch id={`pref-${pref}`} checked={state[pref]} onCheckedChange={(v) => toggle(pref, v)} className="mt-1" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
