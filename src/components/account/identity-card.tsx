"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, ImageUp, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { updateBrandingSelfAction } from "@/server/actions/account";
import { COVER_PRESETS, coverDataUrl } from "@/lib/cover-presets";
import { cn } from "@/lib/utils";
import { BrandLogo } from "@/components/shell/brand-logo";
import { BrandingPreview } from "@/components/account/branding-preview";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { HelpTip } from "@/components/help/help-tip";

const ACCEPTED = ["image/png", "image/jpeg", "image/webp"];
const LOGO_MAX = 2 * 1024 * 1024;
const COVER_MAX = 6 * 1024 * 1024;

type CoverKind = "preset" | "photo";
type Placement = "login" | "dashboard" | "both";

export type IdentityCardProps = {
  platformName: string;
  logoFileId: string | null;
  cover: {
    enabled: boolean;
    kind: CoverKind;
    presetId: string;
    fileId: string | null;
    placement: Placement;
  };
  className?: string;
};

const PLACEMENTS: { value: Placement; label: string }[] = [
  { value: "login", label: "Inicio de sesión" },
  { value: "dashboard", label: "Panel de inicio" },
  { value: "both", label: "Ambas" },
];

/** Sube una imagen de identidad (logo o portada) y devuelve el fileId. */
async function uploadBrandingFile(file: File, maxBytes: number, what: string): Promise<string> {
  if (!ACCEPTED.includes(file.type)) throw new Error(`${what} debe ser PNG, JPG o WEBP`);
  if (file.size > maxBytes) {
    throw new Error(`${what} no debe pesar más de ${Math.round(maxBytes / 1024 / 1024)} MB`);
  }
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
  if (!res.ok) throw new Error(data.error ?? `No se pudo subir ${what.toLowerCase()}`);
  return data.fileId as string;
}

export function IdentityCard({ platformName, logoFileId, cover, className }: IdentityCardProps) {
  const router = useRouter();
  const logoInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(platformName);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [saving, startSaving] = useTransition();

  // Estado local de la portada; se guarda con "Guardar portada"
  const [enabled, setEnabled] = useState(cover.enabled);
  const [kind, setKind] = useState<CoverKind>(cover.kind);
  const [presetId, setPresetId] = useState(cover.presetId);
  const [placement, setPlacement] = useState<Placement>(cover.placement);

  const coverDirty =
    enabled !== cover.enabled ||
    kind !== cover.kind ||
    presetId !== cover.presetId ||
    placement !== cover.placement;

  const selectedPreset = COVER_PRESETS.find((p) => p.id === presetId) ?? COVER_PRESETS[0];
  const previewUrl = !enabled
    ? null
    : kind === "photo"
      ? cover.fileId
        ? `/api/files/${cover.fileId}`
        : null
      : coverDataUrl(selectedPreset.svg);

  function runSave(
    input: Parameters<typeof updateBrandingSelfAction>[0],
    successMsg: string,
    after?: () => void
  ) {
    startSaving(async () => {
      const result = await updateBrandingSelfAction(input);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(successMsg);
      after?.();
      router.refresh();
    });
  }

  async function onLogoFile(file: File) {
    setUploadingLogo(true);
    try {
      const fileId = await uploadBrandingFile(file, LOGO_MAX, "El logo");
      const result = await updateBrandingSelfAction({ logoFileId: fileId });
      if ("error" in result) throw new Error(result.error);
      toast.success("Logo actualizado");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo actualizar el logo");
    } finally {
      setUploadingLogo(false);
      if (logoInput.current) logoInput.current.value = "";
    }
  }

  async function onCoverFile(file: File) {
    setUploadingCover(true);
    try {
      const fileId = await uploadBrandingFile(file, COVER_MAX, "La portada");
      const result = await updateBrandingSelfAction({
        cover: { fileId, kind: "photo", enabled, placement },
      });
      if ("error" in result) throw new Error(result.error);
      toast.success("Foto de portada actualizada");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo subir la portada");
    } finally {
      setUploadingCover(false);
      if (coverInput.current) coverInput.current.value = "";
    }
  }

  function saveName() {
    const trimmed = name.trim();
    if (trimmed === platformName) return;
    runSave({ platformName: trimmed }, "Nombre actualizado");
  }

  function saveCover() {
    if (enabled && kind === "photo" && !cover.fileId) {
      toast.error("Sube una foto de portada o elige una portada vectorial");
      return;
    }
    runSave({ cover: { enabled, kind, presetId, placement } }, "Portada guardada");
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-heading text-base">
          <span className="flex size-7 items-center justify-center rounded-md bg-section-soft text-section-strong">
            <Building2 className="size-4" aria-hidden />
          </span>
          Identidad de la empresa
        </CardTitle>
        <CardDescription>
          Nombre, logo y portada que ven todos los usuarios. Los cambios se aplican de inmediato.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        {/* Logo */}
        <section aria-labelledby="identity-logo" className="space-y-3">
          <h3 id="identity-logo" className="text-sm font-semibold">
            Logo
          </h3>
          <div className="flex flex-wrap items-center gap-4">
            <BrandLogo logoFileId={logoFileId} size={64} className="border shadow-sm" />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className="h-11"
                disabled={uploadingLogo}
                onClick={() => logoInput.current?.click()}
              >
                {uploadingLogo ? (
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
                  onClick={() => runSave({ logoFileId: null }, "Se restauró el logo por defecto")}
                >
                  <Trash2 className="size-4" aria-hidden />
                  Quitar
                </Button>
              )}
              <input
                ref={logoInput}
                type="file"
                accept={ACCEPTED.join(",")}
                className="hidden"
                aria-label="Archivo del logo"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void onLogoFile(file);
                }}
              />
            </div>
            <p className="w-full text-xs text-muted-foreground">
              PNG, JPG o WEBP · máx. 2 MB · se ve mejor cuadrado (mínimo 128 × 128).
            </p>
          </div>
        </section>

        {/* Nombre */}
        <section aria-labelledby="identity-name" className="max-w-sm space-y-2">
          <Label htmlFor="platform-name" id="identity-name" className="text-sm font-semibold">
            Nombre de la plataforma
          </Label>
          <div className="flex gap-2">
            <Input
              id="platform-name"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              className="h-11"
            />
            <Button
              className="h-11 bg-section text-white hover:bg-section-strong"
              disabled={saving || name.trim() === platformName || name.trim().length < 2}
              onClick={saveName}
            >
              {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Guardar
            </Button>
          </div>
        </section>

        {/* Portada */}
        <section aria-labelledby="identity-cover" className="space-y-5 border-t pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 id="identity-cover" className="text-sm font-semibold">
                Portada
              </h3>
              <p className="text-xs text-muted-foreground">
                Imagen de fondo del inicio de sesión y/o del panel de inicio.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="cover-enabled" checked={enabled} onCheckedChange={setEnabled} />
              <Label htmlFor="cover-enabled">Mostrar portada</Label>
            </div>
          </div>

          <div
            className={cn(
              "grid gap-6 lg:grid-cols-[1fr_auto]",
              !enabled && "pointer-events-none opacity-50"
            )}
            aria-disabled={!enabled}
          >
            <div className="space-y-5">
              {/* Tipo */}
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Tipo
                </p>
                <div
                  role="radiogroup"
                  aria-label="Tipo de portada"
                  className="inline-flex rounded-lg border bg-muted/40 p-1"
                >
                  {(
                    [
                      { value: "preset", label: "Vectorial" },
                      { value: "photo", label: "Foto" },
                    ] as { value: CoverKind; label: string }[]
                  ).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={kind === opt.value}
                      disabled={!enabled}
                      onClick={() => setKind(opt.value)}
                      className={cn(
                        "h-9 rounded-md px-4 text-sm font-medium transition-colors",
                        kind === opt.value
                          ? "bg-card text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {kind === "preset" ? (
                <div
                  role="radiogroup"
                  aria-label="Portada vectorial"
                  className="grid grid-cols-2 gap-3 sm:grid-cols-3"
                >
                  {COVER_PRESETS.map((preset) => {
                    const selected = preset.id === presetId;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        aria-label={`${preset.name}: ${preset.description}`}
                        title={preset.description}
                        disabled={!enabled}
                        onClick={() => setPresetId(preset.id)}
                        className={cn(
                          "group overflow-hidden rounded-xl border text-left outline-none transition-shadow",
                          "focus-visible:ring-2 focus-visible:ring-ring/60",
                          selected && "ring-2 ring-section ring-offset-2 ring-offset-card"
                        )}
                      >
                        <span
                          aria-hidden
                          className="block aspect-video w-full bg-slate-900"
                          style={{
                            backgroundImage: `url("${coverDataUrl(preset.svg)}")`,
                            backgroundSize: "cover",
                            backgroundPosition: "center",
                          }}
                        />
                        <span
                          className={cn(
                            "block px-2.5 py-1.5 text-xs font-medium",
                            selected ? "text-section-strong" : "text-foreground"
                          )}
                        >
                          {preset.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-3">
                  <div
                    className="relative aspect-video w-full max-w-sm overflow-hidden rounded-xl border bg-muted/40"
                    aria-label={cover.fileId ? "Foto de portada actual" : "Sin foto de portada"}
                    role="img"
                    style={
                      cover.fileId
                        ? {
                            backgroundImage: `url("/api/files/${cover.fileId}")`,
                            backgroundSize: "cover",
                            backgroundPosition: "center",
                          }
                        : undefined
                    }
                  >
                    {!cover.fileId && (
                      <span className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                        Aún no hay foto
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      className="h-11"
                      disabled={uploadingCover || !enabled}
                      onClick={() => coverInput.current?.click()}
                    >
                      {uploadingCover ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                      ) : (
                        <ImageUp className="size-4" aria-hidden />
                      )}
                      {cover.fileId ? "Cambiar foto" : "Subir foto"}
                    </Button>
                    {cover.fileId && (
                      <Button
                        variant="ghost"
                        className="h-11 text-muted-foreground"
                        disabled={saving}
                        onClick={() =>
                          runSave({ cover: { fileId: null } }, "Se quitó la foto de portada")
                        }
                      >
                        <Trash2 className="size-4" aria-hidden />
                        Quitar
                      </Button>
                    )}
                    <input
                      ref={coverInput}
                      type="file"
                      accept={ACCEPTED.join(",")}
                      className="hidden"
                      aria-label="Archivo de la portada"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void onCoverFile(file);
                      }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    PNG, JPG o WEBP · máx. 6 MB · recomendado 1600 × 900 o mayor, horizontal.
                  </p>
                </div>
              )}

              {/* Dónde */}
              <fieldset className="space-y-2">
                <legend className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Dónde
                  <HelpTip topic="branding.cover" value={{ placement }} />
                </legend>
                <RadioGroup
                  value={placement}
                  onValueChange={(v) => setPlacement(v as Placement)}
                  className="flex flex-wrap gap-x-6 gap-y-2"
                  disabled={!enabled}
                >
                  {PLACEMENTS.map((opt) => (
                    <div key={opt.value} className="flex items-center gap-2">
                      <RadioGroupItem id={`placement-${opt.value}`} value={opt.value} />
                      <Label htmlFor={`placement-${opt.value}`} className="font-normal">
                        {opt.label}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </fieldset>
            </div>

            {/* Previsualización */}
            <div className="space-y-2 lg:w-[340px]">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Previsualización
              </p>
              <BrandingPreview
                platformName={name.trim() || platformName}
                logoFileId={logoFileId}
                coverUrl={previewUrl}
                placement={placement}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              className="h-11 bg-section text-white hover:bg-section-strong"
              disabled={saving || !coverDirty}
              onClick={saveCover}
            >
              {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Guardar portada
            </Button>
            {coverDirty && (
              <span className="text-xs text-muted-foreground">Tienes cambios sin guardar.</span>
            )}
          </div>
        </section>
      </CardContent>
    </Card>
  );
}
