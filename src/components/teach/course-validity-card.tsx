"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Info, Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  computeExpiry,
  describePolicy,
  VALIDITY_LABEL,
  type ValidityMode,
} from "@/lib/validity";
import { formatLongDate } from "@/lib/validity-format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { updateCourseAction } from "@/server/actions/teacher-courses";
import { HelpTip } from "@/components/help/help-tip";

const MODES: { value: ValidityMode; hint: string }[] = [
  { value: "lifetime", hint: "El certificado nunca vence." },
  {
    value: "calendar_year",
    hint: "Vence el 31 de diciembre del año en que se emite. Útil para normas que se renuevan cada año.",
  },
  { value: "months", hint: "Vence un número fijo de meses después de aprobar el curso." },
];

const MIN_MONTHS = 1;
const MAX_MONTHS = 120;

function parseMonths(raw: string): number | null {
  if (!/^\d+$/.test(raw.trim())) return null;
  const n = Number(raw);
  return n >= MIN_MONTHS && n <= MAX_MONTHS ? n : null;
}

/**
 * Vigencia del certificado del curso (vitalicio · año calendario · N meses).
 * Se congela al emitir: cambiarla solo afecta a los certificados futuros.
 */
export function CourseValidityCard({
  courseId,
  initialMode,
  initialMonths,
  hasCertificate,
  className,
}: {
  courseId: string;
  initialMode: ValidityMode;
  initialMonths: number | null;
  /** El curso tiene plantilla asignada (si no, la vigencia aún no se aplica) */
  hasCertificate: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState({ mode: initialMode, months: initialMonths });
  const [mode, setMode] = useState<ValidityMode>(initialMode);
  const [monthsText, setMonthsText] = useState(String(initialMonths ?? 12));
  const [saving, startSaving] = useTransition();

  const months = parseMonths(monthsText);
  const monthsInvalid = mode === "months" && months === null;
  const dirty =
    mode !== saved.mode || (mode === "months" && months !== null && months !== saved.months);

  // Ejemplo en vivo: fecha de hoy en el navegador (el texto del servidor puede
  // diferir por zona horaria; por eso suppressHydrationWarning en la fecha)
  const expiry = monthsInvalid ? null : computeExpiry(mode, months, new Date());

  function save() {
    if (monthsInvalid) return;
    startSaving(async () => {
      const result = await updateCourseAction(courseId, {
        validityMode: mode,
        validityMonths: mode === "months" ? months : null,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setSaved({ mode, months: mode === "months" ? months : null });
      toast.success("Vigencia guardada", {
        description: "Se aplicará a los certificados que se emitan de aquí en adelante.",
      });
      router.refresh();
    });
  }

  return (
    <Card id="vigencia" className={cn("scroll-mt-24 shadow-[0_1px_2px_rgb(15_23_42/0.05)]", className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 font-heading text-base">
          Vigencia del certificado
          <HelpTip topic="course.validity" value={{ mode, months: mode === "months" ? months : null }} />
        </CardTitle>
        <CardDescription>
          Cuánto tiempo es válido el certificado que se emite al aprobar este curso.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <fieldset className="grid gap-2">
          <legend className="sr-only">Vigencia del certificado</legend>
          <RadioGroup
            value={mode}
            onValueChange={(v) => setMode(v as ValidityMode)}
            className="gap-2"
          >
            {MODES.map((option) => {
              const id = `validity-${option.value}`;
              const active = mode === option.value;
              return (
                <div
                  key={option.value}
                  className={cn(
                    "rounded-xl border p-3 transition-colors duration-150",
                    active ? "border-section bg-section-soft/40" : "hover:border-section/40"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <RadioGroupItem value={option.value} id={id} className="mt-0.5" />
                    <Label htmlFor={id} className="grid cursor-pointer gap-1 font-normal leading-snug">
                      <span className="text-sm font-medium">{VALIDITY_LABEL[option.value]}</span>
                      <span className="text-xs text-muted-foreground">{option.hint}</span>
                    </Label>
                  </div>

                  {option.value === "months" && active && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 pl-7">
                      <Label htmlFor="validity-months" className="text-sm font-normal">
                        Vence a los
                      </Label>
                      <Input
                        id="validity-months"
                        type="number"
                        inputMode="numeric"
                        min={MIN_MONTHS}
                        max={MAX_MONTHS}
                        step={1}
                        value={monthsText}
                        onChange={(e) => setMonthsText(e.target.value)}
                        aria-invalid={monthsInvalid || undefined}
                        aria-describedby="validity-months-help"
                        className="h-9 w-20 text-center tabular-nums"
                      />
                      <span className="text-sm">
                        {months === 1 ? "mes" : "meses"} de aprobar
                      </span>
                      <p
                        id="validity-months-help"
                        className={cn(
                          "flex w-full items-center gap-1 text-xs",
                          monthsInvalid ? "text-destructive" : "text-muted-foreground"
                        )}
                        role={monthsInvalid ? "alert" : undefined}
                      >
                        {monthsInvalid && <TriangleAlert className="size-3.5 shrink-0" aria-hidden />}
                        Un número entero entre {MIN_MONTHS} y {MAX_MONTHS} (10 años).
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </RadioGroup>
        </fieldset>

        {/* Resumen de la política + ejemplo en vivo */}
        <div className="flex gap-3 rounded-xl bg-muted/60 p-3" aria-live="polite">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-section-soft text-section-strong">
            <CalendarClock className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 text-sm">
            <p className="font-medium">
              {monthsInvalid ? "Escribe cuántos meses dura" : describePolicy(mode, months)}
            </p>
            {!monthsInvalid && (
              <p className="text-muted-foreground">
                {expiry ? (
                  <>
                    Si alguien aprueba hoy, su certificado vence el{" "}
                    <strong className="font-semibold text-foreground" suppressHydrationWarning>
                      {formatLongDate(expiry)}
                    </strong>
                    .
                  </>
                ) : (
                  "Si alguien aprueba hoy, su certificado no vencerá nunca."
                )}
              </p>
            )}
          </div>
        </div>

        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-px size-3.5 shrink-0" aria-hidden />
          Cambiar la vigencia solo afecta a los certificados que se emitan de aquí en adelante.
        </p>

        {!hasCertificate && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
            <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
            Este curso todavía no emite certificado: la vigencia se aplicará cuando le asignes
            una plantilla.
          </p>
        )}

        <div className="flex justify-end">
          <Button
            onClick={save}
            disabled={saving || !dirty || monthsInvalid}
            className="h-11 bg-cta px-6 text-cta-foreground hover:bg-cta/90"
          >
            {saving && <Loader2 className="animate-spin" aria-hidden />}
            {saving ? "Guardando…" : "Guardar vigencia"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
