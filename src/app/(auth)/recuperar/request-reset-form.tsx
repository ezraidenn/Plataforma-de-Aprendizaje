"use client";

import { useActionState } from "react";
import { Loader2, MailCheck, TriangleAlert } from "lucide-react";
import { requestResetAction, type RequestResetState } from "@/server/auth/account-actions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function RequestResetForm() {
  const [state, formAction, pending] = useActionState<RequestResetState, FormData>(requestResetAction, {});

  if (state.sent) {
    return (
      <Card>
        <CardContent className="flex gap-3 pt-6 text-sm">
          <MailCheck className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-hidden />
          <div className="space-y-2">
            <p className="font-medium">Revisa tu correo</p>
            <p className="text-muted-foreground">
              Si el correo corresponde a una cuenta activa, en unos minutos te llegará un enlace para elegir
              una contraseña nueva. Vale 60 minutos. Revisa también la carpeta de correo no deseado.
            </p>
            <p className="text-muted-foreground">¿No llega? Pide a tu instructor que te envíe el acceso.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form action={formAction} className="space-y-4" noValidate>
          {state.error && (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              <TriangleAlert className="size-4 shrink-0" aria-hidden />
              {state.error}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="email">Correo electrónico</Label>
            <Input id="email" name="email" type="email" autoComplete="username" autoFocus required className="h-11" />
          </div>
          <Button type="submit" disabled={pending} className="h-11 w-full bg-cta text-cta-foreground hover:bg-cta/90">
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Enviar enlace
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
