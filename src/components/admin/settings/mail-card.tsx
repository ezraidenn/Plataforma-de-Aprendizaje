import { Mail } from "lucide-react";
import { MAIL_KIND_LABEL, listRecentMails, mailServiceHost, mailStats, type MailKind } from "@/server/mail/outbox";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDateTime, formatRelative } from "@/components/teach/format";
import { TestMailButton } from "./test-mail-button";

const STATUS: Record<string, { label: string; className: string }> = {
  enviado: { label: "Enviado", className: "bg-success/10 text-success" },
  pendiente: { label: "En cola", className: "bg-section-soft text-section-strong" },
  fallido: { label: "Falló", className: "bg-destructive/10 text-destructive" },
  omitido: { label: "No se envió", className: "" },
};

/** Correo: estado del servicio, cifras del día, prueba de envío y últimos correos. */
export function MailCard() {
  const stats = mailStats();
  const host = mailServiceHost();
  const rows = listRecentMails(25);

  return (
    <Card className="shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 font-heading text-base">
              <Mail className="size-4 text-section-strong" aria-hidden />
              Correo
            </CardTitle>
            <CardDescription>
              {stats.configured
                ? `Los correos salen por el servicio de correo del club (${host ?? "configurado"}). Los enlaces llevan a la dirección en la red.`
                : "Sin configurar: faltan CORREO_API_URL y CORREO_API_KEY en el archivo .env del servidor. No se envía ningún correo."}
            </CardDescription>
          </div>
          <TestMailButton disabled={!stats.configured} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Enviados (24 h)", value: stats.sent24h },
            { label: "En cola", value: stats.pending },
            { label: "Fallidos (24 h)", value: stats.failed24h },
            { label: "Límite diario", value: stats.dailyCap },
          ].map((s) => (
            <div key={s.label} className="rounded-lg border bg-muted/30 px-3 py-2">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="font-heading text-lg font-semibold tabular-nums">{s.value}</p>
            </div>
          ))}
        </div>

        {rows.length === 0 ? (
          <p className="rounded-xl border py-8 text-center text-sm text-muted-foreground">Aún no se ha enviado ningún correo.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border">
            <Table>
              <TableHeader className="bg-secondary/60 [&_th]:h-9 [&_th]:text-[11px] [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted-foreground">
                <TableRow className="hover:bg-transparent">
                  <TableHead scope="col">Correo</TableHead>
                  <TableHead scope="col">Para</TableHead>
                  <TableHead scope="col">Estado</TableHead>
                  <TableHead scope="col">Fecha</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="[&_tr]:transition-colors [&_tr:hover]:bg-section-soft/40">
                {rows.map((r) => {
                  const st = STATUS[r.status] ?? STATUS.omitido;
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{MAIL_KIND_LABEL[r.kind as MailKind] ?? r.kind}</TableCell>
                      <TableCell className="max-w-56">
                        <span className="block truncate">{r.userName ?? r.toAddress}</span>
                        <span className="block truncate text-xs text-muted-foreground">{r.toAddress}</span>
                      </TableCell>
                      <TableCell>
                        {r.error ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge variant="secondary" tabIndex={0} className={`cursor-default ${st.className}`}>
                                {st.label}
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-sm break-words">{r.error}</TooltipContent>
                          </Tooltip>
                        ) : (
                          <Badge variant="secondary" className={st.className}>
                            {st.label}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground" title={formatDateTime(r.sentAt ?? r.createdAt)}>
                        {formatRelative(r.sentAt ?? r.createdAt)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
