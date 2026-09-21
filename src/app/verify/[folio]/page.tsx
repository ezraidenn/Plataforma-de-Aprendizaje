import { BadgeCheck, CalendarX2, SearchX, ShieldX } from "lucide-react";
import { verifyCertificate } from "@/server/services/certificates";
import { getBranding } from "@/server/services/branding";
import { BrandLogo } from "@/components/shell/brand-logo";
import { FolioForm } from "./folio-form";

// Página pública (permitida en el middleware). Siempre consulta la base:
// un certificado revocado debe verse revocado al instante, sin caché.
export const dynamic = "force-dynamic";

export const metadata = { title: "Verificación de certificado" };

const LONG_DATE = new Intl.DateTimeFormat("es-MX", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

/**
 * /verify/[folio] (DISENO-UX §2.15): destino del QR del certificado. Sin
 * sesión, sin shell; responsive desde 375px. No muestra calificación ni email
 * y no ofrece descarga del PDF (eso es del alumno autenticado).
 * El verde/rojo del resultado es semántico (válido/revocado), no de marca.
 * Un certificado VENCIDO se muestra en ámbar, nunca en rojo: es auténtico y
 * acredita lo que acreditó durante su periodo de vigencia.
 */
export default async function VerifyPage({
  params,
}: {
  params: Promise<{ folio: string }>;
}) {
  const { folio } = await params;
  const result = verifyCertificate(decodeURIComponent(folio));
  const branding = getBranding();

  return (
    <div className="relative flex min-h-dvh flex-col items-center overflow-hidden px-4 pb-10 pt-12 sm:pt-16">
      {/* Panel azul noche arriba (como el login); la card "flota" sobre él */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[22rem] bg-[linear-gradient(160deg,#0f172a,#1e1b4b)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 left-1/2 h-72 w-[42rem] -translate-x-1/2 rounded-full bg-primary/30 blur-3xl"
      />

      {/* Identidad de la empresa sobre el panel oscuro */}
      <div className="anim-rise relative flex flex-col items-center gap-3 text-center text-white">
        <BrandLogo logoFileId={branding.logoFileId} size={44} className="shadow-lg" />
        <div>
          <p className="font-heading text-lg font-semibold">{branding.platformName}</p>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/70">
            Verificación de certificado
          </p>
        </div>
      </div>

      <div className="relative mt-8 flex w-full flex-col items-center gap-6">

        {result.status === "valid" && result.expired && result.expiresAt ? (
          <main className="anim-rise anim-d1 w-full max-w-md rounded-2xl border-2 border-amber-400 bg-card p-6 text-center shadow-xl shadow-black/20 sm:p-8">
            <span className="anim-pop mx-auto flex size-16 items-center justify-center rounded-full bg-amber-100 text-amber-600">
              <CalendarX2 className="size-9" aria-hidden />
            </span>
            <h1 className="mt-4 font-heading text-2xl font-bold text-amber-700">
              Certificado auténtico · Vencido
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Fue válido del {LONG_DATE.format(result.issuedAt)} al{" "}
              {LONG_DATE.format(result.expiresAt)}.
            </p>

            <div className="mt-6 space-y-1">
              <p className="font-heading text-lg font-semibold">{result.studentName}</p>
              <p className="text-base">{result.courseTitle}</p>
            </div>

            <dl className="mt-6 space-y-1.5 border-t pt-4 text-sm">
              <div className="flex flex-wrap justify-center gap-x-1.5">
                <dt className="font-semibold">Folio:</dt>
                <dd className="break-all">{result.folio}</dd>
              </div>
              <div className="flex flex-wrap justify-center gap-x-1.5">
                <dt className="font-semibold">Instructor:</dt>
                <dd>{result.teacherName}</dd>
              </div>
            </dl>

            <p className="mt-5 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
              Un certificado vencido no es falso: acredita la capacitación durante su periodo de
              vigencia. Para contar con uno vigente, la persona debe recertificarse.
            </p>
          </main>
        ) : result.status === "valid" ? (
          <main className="anim-rise anim-d1 w-full max-w-md rounded-2xl border-2 border-success bg-card p-6 text-center shadow-xl shadow-black/20 sm:p-8">
            <span className="anim-pop mx-auto flex size-16 items-center justify-center rounded-full bg-success/10 text-success">
              <BadgeCheck className="size-9" aria-hidden />
            </span>
            <h1 className="mt-4 font-heading text-2xl font-bold text-success">
              Certificado válido
            </h1>

            <div className="mt-6 space-y-1">
              <p className="font-heading text-lg font-semibold">{result.studentName}</p>
              <p className="text-base">{result.courseTitle}</p>
            </div>

            <dl className="mt-6 space-y-1.5 border-t pt-4 text-sm">
              <div className="flex flex-wrap justify-center gap-x-1.5">
                <dt className="font-semibold">Emitido:</dt>
                <dd>{LONG_DATE.format(result.issuedAt)}</dd>
              </div>
              <div className="flex flex-wrap justify-center gap-x-1.5">
                {result.expiresAt ? (
                  <>
                    <dt className="font-semibold">Vigente hasta:</dt>
                    <dd>{LONG_DATE.format(result.expiresAt)}</dd>
                  </>
                ) : (
                  <>
                    <dt className="font-semibold">Vigencia:</dt>
                    <dd>permanente</dd>
                  </>
                )}
              </div>
              <div className="flex flex-wrap justify-center gap-x-1.5">
                <dt className="font-semibold">Folio:</dt>
                <dd className="break-all">{result.folio}</dd>
              </div>
              <div className="flex flex-wrap justify-center gap-x-1.5">
                <dt className="font-semibold">Instructor:</dt>
                <dd>{result.teacherName}</dd>
              </div>
            </dl>
          </main>
        ) : result.status === "revoked" ? (
          <main className="anim-rise anim-d1 w-full max-w-md rounded-2xl border-2 border-destructive bg-card p-6 text-center shadow-xl shadow-black/20 sm:p-8">
            <span className="anim-pop mx-auto flex size-16 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <ShieldX className="size-9" aria-hidden />
            </span>
            <h1 className="mt-4 font-heading text-2xl font-bold text-destructive">
              Certificado revocado
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">
              Este certificado fue revocado
              {result.revokedAt ? ` el ${LONG_DATE.format(result.revokedAt)}` : ""} y ya
              no es válido.
            </p>
            <p className="mt-4 break-all border-t pt-4 text-sm">
              <span className="font-semibold">Folio:</span> {result.folio}
            </p>
          </main>
        ) : (
          <main className="anim-rise anim-d1 flex w-full max-w-md flex-col items-center gap-5 rounded-2xl border-2 border-locked bg-card p-6 text-center shadow-xl shadow-black/20 sm:p-8">
            <span className="anim-pop flex size-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <SearchX className="size-9" aria-hidden />
            </span>
            <h1 className="font-heading text-2xl font-bold">
              No existe un certificado con este folio
            </h1>
            <p className="text-sm text-muted-foreground">
              Revisa que el folio esté escrito tal como aparece en el certificado e
              inténtalo de nuevo.
            </p>
            <FolioForm />
          </main>
        )}

        <p className="anim-rise anim-d2 max-w-md text-center text-sm text-muted-foreground">
          Verificado contra los registros de la plataforma.
        </p>
      </div>
    </div>
  );
}
