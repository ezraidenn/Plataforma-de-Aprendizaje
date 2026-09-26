"use client";

import type { Dispatch, SetStateAction } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

/**
 * Las opciones de «Opción única» (se marca la correcta) y «Opción múltiple»
 * (se marcan las correctas), dentro del editor de una pregunta.
 */

export type ChoiceOption = { textMd: string; isCorrect: boolean };

export function ChoiceOptionsEditor({
  type,
  options,
  setOptions,
}: {
  type: "single_choice" | "multiple_choice";
  options: ChoiceOption[];
  setOptions: Dispatch<SetStateAction<ChoiceOption[]>>;
}) {
  const singleCorrectIndex = options.findIndex((o) => o.isCorrect);
  return (
    <div className="grid gap-2">
      <Label>
        Opciones{" "}
        <span className="font-normal text-muted-foreground">
          ({type === "single_choice" ? "marca la correcta" : "marca las correctas"})
        </span>
      </Label>
      {type === "single_choice" ? (
        <RadioGroup
          value={singleCorrectIndex >= 0 ? String(singleCorrectIndex) : ""}
          onValueChange={(v) =>
            setOptions((prev) => prev.map((o, i) => ({ ...o, isCorrect: i === Number(v) })))
          }
          className="gap-2"
        >
          {options.map((option, i) => (
            <div key={i} className="flex items-center gap-2">
              <RadioGroupItem value={String(i)} aria-label={`Opción ${i + 1} correcta`} />
              <Input
                value={option.textMd}
                onChange={(e) =>
                  setOptions((prev) =>
                    prev.map((o, j) => (j === i ? { ...o, textMd: e.target.value } : o))
                  )
                }
                placeholder={`Opción ${i + 1}`}
              />
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Quitar opción ${i + 1}`}
                onClick={() => setOptions((prev) => prev.filter((_, j) => j !== i))}
              >
                <X aria-hidden />
              </Button>
            </div>
          ))}
        </RadioGroup>
      ) : (
        <div className="grid gap-2">
          {options.map((option, i) => (
            <div key={i} className="flex items-center gap-2">
              <Checkbox
                checked={option.isCorrect}
                onCheckedChange={(checked) =>
                  setOptions((prev) =>
                    prev.map((o, j) => (j === i ? { ...o, isCorrect: checked === true } : o))
                  )
                }
                aria-label={`Opción ${i + 1} correcta`}
              />
              <Input
                value={option.textMd}
                onChange={(e) =>
                  setOptions((prev) =>
                    prev.map((o, j) => (j === i ? { ...o, textMd: e.target.value } : o))
                  )
                }
                placeholder={`Opción ${i + 1}`}
              />
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Quitar opción ${i + 1}`}
                onClick={() => setOptions((prev) => prev.filter((_, j) => j !== i))}
              >
                <X aria-hidden />
              </Button>
            </div>
          ))}
        </div>
      )}
      <Button
        size="sm"
        variant="outline"
        className="justify-self-start"
        onClick={() => setOptions((prev) => [...prev, { textMd: "", isCorrect: false }])}
      >
        <Plus aria-hidden />
        Agregar opción
      </Button>
    </div>
  );
}
