"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Step = { token: string; text: string };

function Row({
  step,
  index,
  total,
  onMove,
}: {
  step: Step;
  index: number;
  total: number;
  onMove: (from: number, to: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: step.token,
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex min-h-11 items-center gap-2 rounded-lg border bg-card px-2 py-1.5",
        isDragging && "relative z-10 shadow-lg ring-2 ring-primary/30"
      )}
    >
      <button
        type="button"
        className="flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-accent active:cursor-grabbing"
        aria-label={`Arrastrar «${step.text}»`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" aria-hidden />
      </button>
      <span className="w-5 shrink-0 text-center text-sm font-semibold tabular-nums text-muted-foreground">
        {index + 1}
      </span>
      <span className="min-w-0 flex-1 text-base">{step.text}</span>
      <Button
        size="icon-sm"
        variant="ghost"
        disabled={index === 0}
        aria-label={`Subir «${step.text}»`}
        onClick={() => onMove(index, index - 1)}
      >
        <ArrowUp aria-hidden />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        disabled={index === total - 1}
        aria-label={`Bajar «${step.text}»`}
        onClick={() => onMove(index, index + 1)}
      >
        <ArrowDown aria-hidden />
      </Button>
    </li>
  );
}

/**
 * «Ordenar pasos»: flechas para mover de a uno y arrastre (ratón, dedo o
 * teclado). `order` son los tokens en el orden actual; `onChange` recibe el
 * nuevo orden completo.
 */
export function OrderingControl({
  steps,
  order,
  onChange,
}: {
  /** Pasos tal como llegan (revueltos) */
  steps: Step[];
  /** Tokens en el orden que eligió el alumno; vacío = aún no mueve nada */
  order: string[];
  onChange: (order: string[]) => void;
}) {
  const byToken = new Map(steps.map((s) => [s.token, s]));
  const current: Step[] =
    order.length === steps.length && order.every((t) => byToken.has(t))
      ? order.map((t) => byToken.get(t)!)
      : steps;
  const tokens = current.map((s) => s.token);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function move(from: number, to: number) {
    if (from < 0 || to < 0 || to >= tokens.length) return;
    onChange(arrayMove(tokens, from, to));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    move(tokens.indexOf(String(active.id)), tokens.indexOf(String(over.id)));
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Acomoda los pasos en el orden correcto: arrástralos o usa las flechas.
      </p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={tokens} strategy={verticalListSortingStrategy}>
          <ol className="space-y-1.5">
            {current.map((step, i) => (
              <Row key={step.token} step={step} index={i} total={current.length} onMove={move} />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
    </div>
  );
}
