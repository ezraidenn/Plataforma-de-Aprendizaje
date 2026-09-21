"use client";

import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { RadioGroupItem } from "@/components/ui/radio-group";

/**
 * Opción de radio en tarjeta (dentro de un <RadioGroup>): título, ayuda y, si
 * está activa, un control extra debajo (selector, nombre…). El control extra
 * queda FUERA del <label> para no anidar elementos interactivos.
 */
export function ChoiceOption({
  id,
  value,
  title,
  hint,
  active,
  disabled,
  children,
}: {
  id: string;
  value: string;
  title: string;
  hint?: React.ReactNode;
  active: boolean;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-3 transition-colors duration-150",
        active ? "border-section bg-section-soft/40" : "hover:border-section/40",
        disabled && "opacity-60 hover:border-border"
      )}
    >
      <div className="flex items-start gap-3">
        <RadioGroupItem value={value} id={id} disabled={disabled} className="mt-0.5" />
        <Label
          htmlFor={id}
          className={cn("grid gap-1 font-normal leading-snug", !disabled && "cursor-pointer")}
        >
          <span className="text-sm font-medium">{title}</span>
          {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
        </Label>
      </div>
      {active && children && <div className="mt-3 pl-7">{children}</div>}
    </div>
  );
}
