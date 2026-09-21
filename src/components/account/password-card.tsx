"use client";

import { useState, useTransition } from "react";
import { KeyRound, Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { changeOwnPasswordAction } from "@/server/actions/account";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MIN_LENGTH = 8;

export function PasswordCard({ className }: { className?: string }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touched, setTouched] = useState(false);
  const [saving, startSaving] = useTransition();

  const tooShort = next.length > 0 && next.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && next !== confirm;
  const sameAsCurrent = next.length > 0 && next === current;
  const valid =
    current.length > 0 && next.length >= MIN_LENGTH && next === confirm && !sameAsCurrent;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    startSaving(async () => {
      const result = await changeOwnPasswordAction({ currentPassword: current, newPassword: next });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Contraseña actualizada. Se cerraron tus otras sesiones.");
      setCurrent("");
      setNext("");
      setConfirm("");
      setTouched(false);
    });
  }

  let newHint = `Mínimo ${MIN_LENGTH} caracteres`;
  if (sameAsCurrent) newHint = "Debe ser distinta a la actual";
  else if (tooShort) newHint = `Faltan ${MIN_LENGTH - next.length} caracteres`;

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-heading text-base">
          <span className="flex size-7 items-center justify-center rounded-md bg-section-soft text-section-strong">
            <KeyRound className="size-4" aria-hidden />
          </span>
          Contraseña
        </CardTitle>
        <CardDescription>
          Usa al menos {MIN_LENGTH} caracteres. Necesitas tu contraseña actual para cambiarla.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="max-w-md space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="pw-current">Contraseña actual</Label>
            <Input
              id="pw-current"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className="h-11"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pw-new">Nueva contraseña</Label>
            <Input
              id="pw-new"
              type="password"
              autoComplete="new-password"
              minLength={MIN_LENGTH}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              aria-invalid={tooShort || sameAsCurrent || undefined}
              aria-describedby="pw-new-hint"
              className="h-11"
              required
            />
            <p
              id="pw-new-hint"
              className={
                tooShort || sameAsCurrent
                  ? "text-xs text-destructive"
                  : "text-xs text-muted-foreground"
              }
            >
              {newHint}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pw-confirm">Confirmar nueva contraseña</Label>
            <Input
              id="pw-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              aria-invalid={mismatch || undefined}
              aria-describedby={mismatch ? "pw-confirm-error" : undefined}
              className="h-11"
              required
            />
            {mismatch && (
              <p id="pw-confirm-error" className="text-xs text-destructive" role="alert">
                Las contraseñas no coinciden
              </p>
            )}
          </div>

          <p className="flex items-start gap-1.5 text-xs text-warning">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Se cerrarán tus otras sesiones; esta seguirá abierta.
          </p>

          <Button
            type="submit"
            className="h-11 bg-section text-white hover:bg-section-strong"
            disabled={saving || (touched && !valid)}
          >
            {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Cambiar contraseña
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
