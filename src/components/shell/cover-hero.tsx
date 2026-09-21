import { BrandLogo } from "@/components/shell/brand-logo";

/**
 * Hero compacto con la portada de la empresa (solo cuando está activada para el
 * dashboard). Server-safe. Si `coverUrl` es null no renderiza nada.
 */
export function CoverHero({
  coverUrl,
  platformName,
  logoFileId,
  greeting,
  subtitle,
}: {
  coverUrl: string | null;
  platformName: string;
  logoFileId: string | null;
  greeting: string;
  subtitle?: string;
}) {
  if (!coverUrl) return null;
  return (
    <section
      aria-label="Portada"
      className="anim-rise relative h-36 overflow-hidden rounded-2xl border text-white shadow-[0_1px_2px_rgb(15_23_42/0.05)] md:h-44"
      style={{
        backgroundImage: `url("${coverUrl}")`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgb(15_23_42/0.25)_0%,rgb(15_23_42/0.75)_100%)]"
      />
      <div className="relative flex h-full flex-col justify-between p-5 md:p-6">
        <div className="flex items-center gap-2.5">
          <BrandLogo logoFileId={logoFileId} size={32} className="shadow-md" />
          <span className="font-heading text-sm font-semibold text-white/90">{platformName}</span>
        </div>
        <div>
          <p className="font-heading text-xl font-bold leading-tight drop-shadow md:text-2xl">
            {greeting}
          </p>
          {subtitle && <p className="mt-0.5 text-sm text-white/80">{subtitle}</p>}
        </div>
      </div>
    </section>
  );
}
