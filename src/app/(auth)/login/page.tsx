import type { Metadata } from "next";
import { coverImageFor, getBranding } from "@/server/services/branding";
import { listPublishedCoursesPublic } from "@/server/services/courses";
import { cn } from "@/lib/utils";
import { BrandLogo } from "@/components/shell/brand-logo";
import { LoginForm } from "./login-form";
import { CourseCarousel } from "./course-carousel";

export const metadata: Metadata = { title: "Iniciar sesión" };

export default function LoginPage() {
  const branding = getBranding();
  const cover = coverImageFor(branding, "login");
  const courses = listPublishedCoursesPublic(8);
  const year = new Date().getFullYear();

  return (
    <main className="flex min-h-dvh flex-col lg:grid lg:grid-cols-[1.1fr_1fr]">
      {/* ─── Panel de marca (azul noche / portada). En móvil es la franja
             superior: el logo blanco siempre va sobre fondo oscuro. ───────── */}
      <section
        className={cn(
          "relative flex flex-col justify-between overflow-hidden px-6 pb-16 pt-8 text-white lg:p-12",
          !cover && "bg-[linear-gradient(160deg,#0f172a_0%,#1e1b4b_55%,#312e81_100%)]"
        )}
        style={
          cover
            ? {
                backgroundImage: `url("${cover}")`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }
            : undefined
        }
      >
        {cover ? (
          <>
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgb(15_23_42/0.55)_0%,rgb(15_23_42/0.45)_50%,rgb(15_23_42/0.8)_100%)]"
            />
            {/* Oscurece la columna del texto (izquierda) sin apagar la foto */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgb(2_6_23/0.55)_0%,rgb(2_6_23/0.3)_50%,transparent_85%)]"
            />
          </>
        ) : (
          <>
            <div
              aria-hidden
              className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-indigo-500/25 blur-3xl"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute -bottom-32 -left-16 size-96 rounded-full bg-cyan-400/20 blur-3xl"
            />
          </>
        )}

        {/* Móvil: logo + nombre centrados. Escritorio: arriba a la izquierda */}
        <div className="relative flex flex-col items-center gap-3 text-center lg:flex-row lg:text-left">
          <BrandLogo logoFileId={branding.logoFileId} size={56} className="shadow-lg lg:size-11" />
          <div>
            <h1 className="text-halo font-heading text-2xl font-bold lg:text-lg">{branding.platformName}</h1>
            <p className="text-halo mt-0.5 text-[13px] text-slate-100 lg:hidden">
              Inicia sesión con tu correo y contraseña
            </p>
          </div>
        </div>

        {/* Escritorio: mensaje sobrio + cursos disponibles */}
        <div className="relative hidden space-y-8 lg:block">
          <div className="max-w-md space-y-2">
            <h2 className="text-halo font-heading text-3xl font-semibold leading-tight tracking-tight">
              Portal de capacitación interna
            </h2>
            <p className="text-halo text-[15px] leading-relaxed text-slate-100">
              Ingresa con la cuenta que te asignó Recursos Humanos o tu instructor para consultar
              tus cursos, presentar evaluaciones y descargar tus constancias.
            </p>
          </div>
          <CourseCarousel courses={courses} />
        </div>

        <p className="text-halo relative hidden text-xs text-slate-200 lg:block">
          © {year} {branding.platformName} · Uso exclusivo del personal autorizado
        </p>
      </section>

      {/* ─── Formulario: en móvil la tarjeta "flota" sobre la franja oscura ── */}
      <section className="-mt-10 flex flex-1 items-start justify-center px-4 pb-8 lg:mt-0 lg:items-center lg:p-6">
        <div className="anim-rise w-full max-w-[400px]">
          <div className="mb-6 hidden lg:block">
            <h2 className="font-heading text-2xl font-bold tracking-tight">Iniciar sesión</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Usa tu correo corporativo y tu contraseña.
            </p>
          </div>
          <LoginForm />
          <p className="mt-6 text-center text-[13px] text-muted-foreground">
            ¿Olvidaste tu contraseña? Solicita el restablecimiento a tu instructor o al
            administrador.
          </p>
        </div>
      </section>
    </main>
  );
}
