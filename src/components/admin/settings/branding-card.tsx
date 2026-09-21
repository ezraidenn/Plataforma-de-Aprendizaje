"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImageUp, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { updateBrandingAction } from "@/server/actions/admin-branding";
import { BrandLogo } from "@/components/shell/brand-logo";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const ACCEPTED = ["image/png", "image/jpeg", "image/webp"];

export function BrandingCard({
  platformName,
  logoFileId,
}: {
  platformName: string;
  logoFileId: string | null;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(platformName);
  const [uploading, setUploading] = useState(false);
  const [saving, startSaving] = useTransition();

  async function uploadLogo(file: File) {
    if (!ACCEPTED.includes(file.type)) {
      toast.error("El logo debe ser PNG, JPG o WEBP");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("El logo no debe pesar más de 2 MB");
      return;
    }
    setUploading(true);
    try {
      const res = await fetch("/api/uploads", {
        method: "POST",
        headers: {
          "X-File-Name": encodeURIComponent(file.name),
          "X-File-Kind": "branding",
          "Content-Type": file.type,
        },
        body: file,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo subir el logo");

      const result = await updateBrandingAction({ logoFileId: data.fileId });
      if ("error" in result) throw new Error(result.error);

      toast.success("Logo actualizado");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo actualizar el logo");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function removeLogo() {
    startSaving(async () => {
      const result = await updateBrandingAction({ logoFileId: null });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Se restauró el logo por defecto");
      router.refresh();
    });
  }

  function saveName() {
    if (name.trim() === platformName) return;
    startSaving(async () => {
      const result = await updateBrandingAction({ platformName: name });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Nombre actualizado");
      router.refresh();
    });
  }

  return (
    <Card className="anim-rise shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
      <CardHeader>
        <CardTitle className="font-heading text-base">Identidad de la empresa</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-wrap items-center gap-4">
          <BrandLogo logoFileId={logoFileId} size={64} className="border shadow-sm" />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="h-11"
              disabled={uploading}
              onClick={() => fileInput.current?.click()}
            >
              {uploading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <ImageUp className="size-4" aria-hidden />
              )}
              {logoFileId ? "Cambiar logo" : "Subir logo"}
            </Button>
            {logoFileId && (
              <Button
                variant="ghost"
                className="h-11 text-muted-foreground"
                disabled={saving}
                onClick={removeLogo}
              >
                <Trash2 className="size-4" aria-hidden />
                Quitar
              </Button>
            )}
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPTED.join(",")}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadLogo(file);
              }}
            />
          </div>
          <p className="w-full text-xs text-muted-foreground">
            PNG, JPG o WEBP · máx. 2 MB · se ve mejor cuadrado (mínimo 128 × 128). Aparece en el
            encabezado, el inicio de sesión y la página de verificación de certificados.
          </p>
        </div>

        <div className="max-w-sm space-y-2">
          <Label htmlFor="platform-name">Nombre de la plataforma</Label>
          <div className="flex gap-2">
            <Input
              id="platform-name"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              className="h-11"
            />
            <Button
              className="h-11 bg-cta text-cta-foreground hover:bg-cta/90"
              disabled={saving || name.trim() === platformName || name.trim().length < 2}
              onClick={saveName}
            >
              {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Guardar
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
