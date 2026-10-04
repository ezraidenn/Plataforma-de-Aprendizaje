import Link from "next/link";
import { getBranding } from "@/server/services/branding";
import { BrandLogo } from "@/components/shell/brand-logo";

/** Marco sencillo de las pantallas de acceso que llegan desde un correo. */
export function AccountShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
}) {
  const branding = getBranding();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-muted/40 px-4 py-10">
      <div className="anim-rise w-full max-w-[420px] space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <BrandLogo logoFileId={branding.logoFileId} size={52} className="shadow-md" />
          <p className="font-heading text-sm font-semibold text-muted-foreground">{branding.platformName}</p>
        </div>
        <div className="text-center">
          <h1 className="font-heading text-2xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {children}
        <p className="text-center text-[13px] text-muted-foreground">
          <Link href="/login" className="font-medium text-foreground underline-offset-4 hover:underline">
            Volver a iniciar sesión
          </Link>
        </p>
      </div>
    </main>
  );
}
