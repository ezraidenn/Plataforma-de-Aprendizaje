"use client";

import { ExternalLink, Info, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type LinkDetail = {
  url: string;
  description: string;
};

export function isValidHttpUrl(raw: string): boolean {
  const value = raw.trim();
  if (!value) return false;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Campos del enlace externo; el guardado lo hace el formulario padre. */
export function LinkSection({
  url,
  description,
  error,
  onUrlChange,
  onDescriptionChange,
}: {
  url: string;
  description: string;
  error: string | null;
  onUrlChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
}) {
  const valid = isValidHttpUrl(url);
  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor="link-url">URL del enlace</Label>
        <div className="flex gap-2">
          <Input
            id="link-url"
            type="url"
            inputMode="url"
            value={url}
            onChange={(e) => onUrlChange(e.target.value)}
            placeholder="https://…"
            aria-invalid={error ? true : undefined}
            className={cn("flex-1", error && "border-destructive")}
          />
          <Button
            type="button"
            variant="outline"
            disabled={!valid}
            onClick={() => window.open(url.trim(), "_blank", "noopener,noreferrer")}
          >
            <ExternalLink aria-hidden />
            Probar enlace
          </Button>
        </div>
        {error ? (
          <p className="flex items-center gap-1 text-sm text-destructive" role="alert">
            <TriangleAlert className="size-4 shrink-0" aria-hidden />
            {error}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">Debe empezar con http:// o https://</p>
        )}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="link-description">Descripción para el alumno (opcional)</Label>
        <Textarea
          id="link-description"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          rows={3}
          maxLength={1000}
          placeholder="Qué encontrará el alumno al abrir el enlace"
        />
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-kind-link/30 bg-kind-link-tint p-3 text-sm">
        <Info className="mt-0.5 size-4 shrink-0 text-kind-link" aria-hidden />
        <p>El alumno completa este elemento al abrir el enlace en una pestaña nueva.</p>
      </div>
    </>
  );
}
