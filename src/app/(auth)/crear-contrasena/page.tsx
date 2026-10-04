import type { Metadata } from "next";
import { checkToken } from "@/server/mail/tokens";
import { AccountShell } from "@/components/auth/account-shell";
import { SetPasswordForm } from "@/components/auth/set-password-form";
import { TokenProblem } from "@/components/auth/token-problem";

// El enlace lleva el token: que no viaje en el Referer a ningún lado
export const metadata: Metadata = { title: "Crea tu contraseña", referrer: "no-referrer" };
export const dynamic = "force-dynamic";

export default async function CreatePasswordPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  const check = checkToken(t);

  if (!check.ok) {
    return (
      <AccountShell title="Crea tu contraseña">
        <TokenProblem reason={check.reason} />
      </AccountShell>
    );
  }
  return (
    <AccountShell
      title={`Te damos la bienvenida, ${check.fullName.split(/\s+/)[0]}`}
      subtitle={
        <>
          Elige la contraseña con la que entrarás como <strong className="text-foreground">{check.email}</strong>.
        </>
      }
    >
      <SetPasswordForm token={t!} email={check.email} submitLabel="Crear contraseña y entrar" />
    </AccountShell>
  );
}
