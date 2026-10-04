"use client";

import { useActionState, useState } from "react";
import { Eye, EyeOff, Loader2, TriangleAlert } from "lucide-react";
import { setPasswordWithTokenAction, type SetPasswordState } from "@/server/auth/account-actions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Elegir contraseña con el enlace del correo (bienvenida o restablecer). */
export function SetPasswordForm({ token, email, submitLabel }: { token: string; email: string; submitLabel: string }) {
  const [state, formAction, pending] = useActionState<SetPasswordState, FormData>(setPasswordWithTokenAction, {});
  const [show, setShow] = useState(false);

  return (
    <Card>
      <CardContent className="pt-6">
        <form action={formAction} className="space-y-4" noValidate>
          <input type="hidden" name="token" value={token} />
          {/* Para que el navegador ofrezca guardar la contraseña con el usuario correcto */}
          <input type="email" name="username" value={email} autoComplete="username" readOnly hidden />
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
            <Label htmlFor="password">Contraseña nueva</Label>
            <div className="relative">
              <Input
                id="password"
                name="password"
                type={show ? "text" : "password"}
                autoComplete="new-password"
                autoFocus
                required
                minLength={8}
                className="h-11 pr-11"
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"}
                className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground hover:text-foreground"
              >
                {show ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">Al menos 8 caracteres.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm">Escríbela otra vez</Label>
            <Input
              id="confirm"
              name="confirm"
              type={show ? "text" : "password"}
              autoComplete="new-password"
              required
              className="h-11"
            />
          </div>

          <Button type="submit" disabled={pending} className="h-11 w-full bg-cta text-cta-foreground hover:bg-cta/90">
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {submitLabel}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
