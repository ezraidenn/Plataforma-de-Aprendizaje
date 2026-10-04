import type { Metadata } from "next";
import { checkToken } from "@/server/mail/tokens";
import { AccountShell } from "@/components/auth/account-shell";
import { SetPasswordForm } from "@/components/auth/set-password-form";
import { TokenProblem } from "@/components/auth/token-problem";

// El enlace lleva el token: que no viaje en el Referer a ningún lado
export const metadata: Metadata = { title: "Nueva contraseña", referrer: "no-referrer" };
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  const check = checkToken(t);

  if (!check.ok) {
    return (
      <AccountShell title="Nueva contraseña">
        <TokenProblem reason={check.reason} />
      </AccountShell>
    );
  }
  return (
    <AccountShell
      title="Elige una contraseña nueva"
      subtitle={
        <>
          Para la cuenta <strong className="text-foreground">{check.email}</strong>. Al guardarla se cierran las
          sesiones abiertas en otros equipos.
        </>
      }
    >
      <SetPasswordForm token={t!} email={check.email} submitLabel="Guardar y entrar" />
    </AccountShell>
  );
}
