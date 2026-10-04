import type { Metadata } from "next";
import { AccountShell } from "@/components/auth/account-shell";
import { RequestResetForm } from "./request-reset-form";

export const metadata: Metadata = { title: "Recuperar contraseña" };

export default function RecoverPage() {
  return (
    <AccountShell
      title="¿Olvidaste tu contraseña?"
      subtitle="Escribe el correo con el que entras y te mandaremos un enlace para elegir una nueva."
    >
      <RequestResetForm />
    </AccountShell>
  );
}
