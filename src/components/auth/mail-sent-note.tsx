import { MailCheck, MailX } from "lucide-react";

/** Lo que pasó con el correo de acceso tras crear una cuenta. */
export function MailSentNote({ mail }: { mail: { sent: boolean; message: string } }) {
  return mail.sent ? (
    <p className="flex items-start gap-1.5 rounded-lg border border-emerald-600/25 bg-emerald-600/10 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-300">
      <MailCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>
        {mail.message} La contraseña temporal sirve por si no le llega.
      </span>
    </p>
  ) : (
    <p className="flex items-start gap-1.5 rounded-lg border bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
      <MailX className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{mail.message} Dale la contraseña temporal en persona.</span>
    </p>
  );
}
