"use client";

import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DELETE_CONFIRM_WORD, isDeleteConfirmed } from "@/lib/delete-confirm";

/**
 * Borrado definitivo con doble confirmación:
 *  1) qué se borra (`summary`) y qué lo impide (`blockers`, si hay no se sigue);
 *  2) escribir ELIMINAR para habilitar el botón final.
 * `loading` mientras llega el resumen del servidor.
 */
export function DeleteForeverDialog({
  open,
  onOpenChange,
  title,
  description = "No se puede deshacer.",
  loading = false,
  blockers = [],
  summary,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  loading?: boolean;
  blockers?: string[];
  summary?: React.ReactNode;
  pending: boolean;
  /** Recibe lo que se escribió; el servidor lo vuelve a comprobar */
  onConfirm: (confirmWord: string) => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [typed, setTyped] = useState("");
  const blocked = blockers.length > 0;

  // Cada vez que se abre empieza en el paso 1 y sin texto
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setStep(1);
      setTyped("");
    }
  }

  function handleOpenChange(next: boolean) {
    if (pending) return;
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        {step === 1 ? (
          <>
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </DialogHeader>
            {loading ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Revisando qué se borraría…
              </p>
            ) : blocked ? (
              <div className="space-y-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
                <p className="text-sm font-semibold">No se puede eliminar:</p>
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="space-y-2 rounded-xl border bg-muted/40 p-4 text-sm">{summary}</div>
            )}
            <DialogFooter>
              <Button variant="outline" className="h-11" onClick={() => handleOpenChange(false)}>
                {blocked ? "Cerrar" : "Cancelar"}
              </Button>
              {!loading && !blocked && (
                <Button
                  variant="outline"
                  className="h-11 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setStep(2)}
                >
                  Continuar
                </Button>
              )}
            </DialogFooter>
          </>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (isDeleteConfirmed(typed)) onConfirm(typed);
            }}
          >
            <DialogHeader>
              <DialogTitle>Confirma la eliminación</DialogTitle>
              <DialogDescription>Esto no se puede deshacer.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="delete-forever-confirm">
                Escribe <span className="font-semibold">{DELETE_CONFIRM_WORD}</span> para confirmar
              </Label>
              <Input
                id="delete-forever-confirm"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="h-11"
                onClick={() => setStep(1)}
                disabled={pending}
              >
                Atrás
              </Button>
              <Button
                type="submit"
                className="h-11 bg-destructive text-white hover:bg-destructive/90"
                disabled={pending || !isDeleteConfirmed(typed)}
              >
                {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
                {pending ? "Eliminando…" : "Eliminar definitivamente"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
