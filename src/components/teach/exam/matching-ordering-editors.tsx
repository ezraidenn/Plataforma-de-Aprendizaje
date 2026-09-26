"use client";

import type { Dispatch, SetStateAction } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HelpTip } from "@/components/help/help-tip";

/**
 * Los pares de «Relacionar columnas» y los pasos de «Ordenar pasos», dentro del
 * editor de una pregunta.
 */

export type MatchingPair = { left: string; right: string };

export function MatchingPairsEditor({
  pairs,
  setPairs,
}: {
  pairs: MatchingPair[];
  setPairs: Dispatch<SetStateAction<MatchingPair[]>>;
}) {
  return (
    <div className="grid gap-2">
      <Label>Pares para relacionar (mínimo 2)</Label>
      {pairs.map((pair, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            value={pair.left}
            onChange={(e) =>
              setPairs((prev) =>
                prev.map((p, j) => (j === i ? { ...p, left: e.target.value } : p))
              )
            }
            placeholder={`Izquierda ${i + 1}`}
            aria-label={`Lado izquierdo del par ${i + 1}`}
          />
          <span className="text-muted-foreground" aria-hidden>
            →
          </span>
          <Input
            value={pair.right}
            onChange={(e) =>
              setPairs((prev) =>
                prev.map((p, j) => (j === i ? { ...p, right: e.target.value } : p))
              )
            }
            placeholder={`Derecha ${i + 1}`}
            aria-label={`Lado derecho del par ${i + 1}`}
          />
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Quitar par ${i + 1}`}
            onClick={() => setPairs((prev) => prev.filter((_, j) => j !== i))}
          >
            <X aria-hidden />
          </Button>
        </div>
      ))}
      <Button
        size="sm"
        variant="outline"
        className="justify-self-start"
        onClick={() => setPairs((prev) => [...prev, { left: "", right: "" }])}
      >
        <Plus aria-hidden />
        Agregar par
      </Button>
      <p className="text-xs text-muted-foreground">
        El estudiante verá la columna derecha en desorden y deberá emparejarla.
      </p>
    </div>
  );
}

export function OrderingStepsEditor({ steps, setSteps }: { steps: string[]; setSteps: Dispatch<SetStateAction<string[]>> }) {
  const moveStep = (from: number, to: number) =>
    setSteps((prev) => {
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-1.5">
        <Label>Pasos en el orden correcto (3 a 10)</Label>
        <HelpTip topic="exam.ordering" />
      </div>
      <ol className="grid gap-2">
        {steps.map((step, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="w-5 shrink-0 text-center text-sm font-semibold tabular-nums text-muted-foreground">
              {i + 1}
            </span>
            <Input
              value={step}
              onChange={(e) =>
                setSteps((prev) => prev.map((s, j) => (j === i ? e.target.value : s)))
              }
              placeholder={`Paso ${i + 1}`}
              aria-label={`Paso ${i + 1}`}
            />
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Subir paso ${i + 1}`}
              disabled={i === 0}
              onClick={() => moveStep(i, i - 1)}
            >
              <ArrowUp aria-hidden />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Bajar paso ${i + 1}`}
              disabled={i === steps.length - 1}
              onClick={() => moveStep(i, i + 1)}
            >
              <ArrowDown aria-hidden />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Quitar paso ${i + 1}`}
              onClick={() => setSteps((prev) => prev.filter((_, j) => j !== i))}
            >
              <X aria-hidden />
            </Button>
          </li>
        ))}
      </ol>
      <Button
        size="sm"
        variant="outline"
        className="justify-self-start"
        disabled={steps.length >= 10}
        onClick={() => setSteps((prev) => [...prev, ""])}
      >
        <Plus aria-hidden />
        Agregar paso
      </Button>
      <p className="text-xs text-muted-foreground">
        Escríbelos en el orden correcto: el estudiante los verá revueltos y deberá acomodarlos.
      </p>
    </div>
  );
}
