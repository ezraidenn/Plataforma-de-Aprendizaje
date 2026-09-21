"use client";

import { cn } from "@/lib/utils";
import { BrandLogo } from "@/components/shell/brand-logo";

/**
 * Mini mock HTML (≈320 px) del login a dos paneles y del hero del dashboard,
 * mostrando la portada elegida con logo y nombre encima. Solo decorativo.
 */
export function BrandingPreview({
  platformName,
  logoFileId,
  coverUrl,
  placement,
}: {
  platformName: string;
  logoFileId: string | null;
  /** null = sin portada (degradado por defecto) */
  coverUrl: string | null;
  placement: "login" | "dashboard" | "both";
}) {
  const loginCover = coverUrl && placement !== "dashboard" ? coverUrl : null;
  const dashCover = coverUrl && placement !== "login" ? coverUrl : null;

  return (
    <div className="grid gap-4" aria-label="Previsualización de la portada">
      <figure className="space-y-1.5">
        <figcaption className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Inicio de sesión
        </figcaption>
        <div className="w-full max-w-[320px] overflow-hidden rounded-lg border bg-background shadow-sm">
          <div className="grid aspect-[16/10] grid-cols-[1.1fr_1fr]">
            <div
              className={cn(
                "relative flex flex-col justify-between p-2.5 text-white",
                !loginCover && "bg-[linear-gradient(160deg,#0f172a_0%,#1e1b4b_55%,#312e81_100%)]"
              )}
              style={
                loginCover
                  ? {
                      backgroundImage: `url("${loginCover}")`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }
                  : undefined
              }
            >
              {loginCover && (
                <span
                  aria-hidden
                  className="absolute inset-0 bg-[linear-gradient(180deg,rgb(15_23_42/0.55),rgb(15_23_42/0.8))]"
                />
              )}
              <div className="relative flex items-center gap-1.5">
                <BrandLogo logoFileId={logoFileId} size={16} />
                <span className="truncate text-[8px] font-bold">{platformName}</span>
              </div>
              <div className="relative space-y-1">
                <span className="block h-2 w-4/5 rounded-sm bg-white/80" />
                <span className="block h-1.5 w-3/5 rounded-sm bg-white/40" />
                <span className="block h-1.5 w-2/3 rounded-sm bg-white/40" />
              </div>
            </div>
            <div className="flex flex-col justify-center gap-1.5 p-3">
              <span className="block h-2 w-2/3 rounded-sm bg-foreground/70" />
              <span className="block h-4 rounded-sm border bg-muted/40" />
              <span className="block h-4 rounded-sm border bg-muted/40" />
              <span className="block h-4 rounded-sm bg-primary/80" />
            </div>
          </div>
        </div>
      </figure>

      <figure className="space-y-1.5">
        <figcaption className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Panel de inicio
        </figcaption>
        <div className="w-full max-w-[320px] overflow-hidden rounded-lg border bg-background shadow-sm">
          <div className="grid aspect-[16/10] grid-cols-[56px_1fr]">
            <div className="flex flex-col gap-1.5 bg-[linear-gradient(180deg,#0f172a,#1e1b4b)] p-2">
              <div className="flex items-center gap-1">
                <BrandLogo logoFileId={logoFileId} size={12} />
                <span className="block h-1.5 flex-1 rounded-sm bg-white/60" />
              </div>
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={cn(
                    "block h-1.5 rounded-sm",
                    i === 0 ? "bg-white/70" : "bg-white/25"
                  )}
                />
              ))}
            </div>
            <div className="space-y-1.5 p-2">
              {dashCover ? (
                <div
                  className="relative flex h-12 flex-col justify-end overflow-hidden rounded-md p-1.5 text-white"
                  style={{
                    backgroundImage: `url("${dashCover}")`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }}
                >
                  <span
                    aria-hidden
                    className="absolute inset-0 bg-[linear-gradient(180deg,rgb(15_23_42/0.2),rgb(15_23_42/0.75))]"
                  />
                  <div className="relative flex items-center gap-1">
                    <BrandLogo logoFileId={logoFileId} size={12} />
                    <span className="truncate text-[7px] font-bold">{platformName}</span>
                  </div>
                  <span className="relative mt-0.5 block h-1.5 w-1/2 rounded-sm bg-white/80" />
                </div>
              ) : (
                <div className="relative h-8 overflow-hidden rounded-md border bg-card p-1.5">
                  <span aria-hidden className="section-gradient absolute inset-x-0 top-0 h-0.5" />
                  <span className="block h-1.5 w-1/3 rounded-sm bg-foreground/70" />
                  <span className="mt-1 block h-1 w-1/2 rounded-sm bg-muted-foreground/40" />
                </div>
              )}
              <div className="grid grid-cols-2 gap-1.5">
                {[0, 1, 2, 3].map((i) => (
                  <span key={i} className="block h-5 rounded-md border bg-card" />
                ))}
              </div>
            </div>
          </div>
        </div>
      </figure>
    </div>
  );
}
