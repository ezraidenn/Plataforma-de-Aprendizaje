"use client";

import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignHorizontalDistributeCenter,
  AlignLeft,
  AlignRight,
  AlignVerticalDistributeCenter,
  ArrowDownToLine,
  ArrowUpToLine,
  Copy,
  Grid3x3,
  Magnet,
  Redo2,
  Ruler,
  Trash2,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { AlignOp } from "./canvas-geometry";

function TB({
  icon: Icon,
  label,
  onClick,
  active,
  disabled,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClick}
          className={cn(
            "flex size-8 items-center justify-center rounded-md transition-colors",
            active
              ? "bg-section-soft text-section-strong"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
            disabled && "pointer-events-none opacity-35",
          )}
        >
          <Icon className="size-4" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

function Sep() {
  return <span className="mx-1 h-5 w-px bg-border" aria-hidden />;
}

/**
 * Barra de herramientas del lienzo: alinear (a la página con 1 campo, entre sí
 * con varios), distribuir, duplicar, quitar, deshacer/rehacer y ajustes de
 * ayuda (imán, cuadrícula, reglas).
 */
export function AlignToolbar({
  selectedCount,
  canUndo,
  canRedo,
  snapOn,
  showGrid,
  showRulers,
  onAlign,
  onDistribute,
  onDuplicate,
  onRemove,
  onUndo,
  onRedo,
  onToggleSnap,
  onToggleGrid,
  onToggleRulers,
}: {
  selectedCount: number;
  canUndo: boolean;
  canRedo: boolean;
  snapOn: boolean;
  showGrid: boolean;
  showRulers: boolean;
  onAlign: (op: AlignOp) => void;
  onDistribute: (axis: "x" | "y") => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onToggleSnap: () => void;
  onToggleGrid: () => void;
  onToggleRulers: () => void;
}) {
  const none = selectedCount === 0;
  const target = selectedCount > 1 ? "entre sí" : "a la página";
  return (
    <TooltipProvider delayDuration={250}>
      <div
        role="toolbar"
        aria-label="Herramientas del lienzo"
        className="flex flex-wrap items-center gap-0.5 rounded-xl border bg-card px-2 py-1.5 shadow-[0_1px_2px_rgb(15_23_42/0.05)]"
      >
        <TB
          icon={Undo2}
          label="Deshacer (Ctrl+Z)"
          onClick={onUndo}
          disabled={!canUndo}
        />
        <TB
          icon={Redo2}
          label="Rehacer (Ctrl+Y)"
          onClick={onRedo}
          disabled={!canRedo}
        />
        <Sep />
        <TB
          icon={AlignLeft}
          label={`Alinear a la izquierda ${target}`}
          onClick={() => onAlign("left")}
          disabled={none}
        />
        <TB
          icon={AlignCenterHorizontal}
          label={`Centrar horizontalmente ${target}`}
          onClick={() => onAlign("hcenter")}
          disabled={none}
        />
        <TB
          icon={AlignRight}
          label={`Alinear a la derecha ${target}`}
          onClick={() => onAlign("right")}
          disabled={none}
        />
        <Sep />
        <TB
          icon={ArrowUpToLine}
          label={`Alinear arriba ${target}`}
          onClick={() => onAlign("top")}
          disabled={none}
        />
        <TB
          icon={AlignCenterVertical}
          label={`Centrar verticalmente ${target}`}
          onClick={() => onAlign("vcenter")}
          disabled={none}
        />
        <TB
          icon={ArrowDownToLine}
          label={`Alinear abajo ${target}`}
          onClick={() => onAlign("bottom")}
          disabled={none}
        />
        <Sep />
        <TB
          icon={AlignHorizontalDistributeCenter}
          label="Distribuir horizontalmente (3+ campos)"
          onClick={() => onDistribute("x")}
          disabled={selectedCount < 3}
        />
        <TB
          icon={AlignVerticalDistributeCenter}
          label="Distribuir verticalmente (3+ campos)"
          onClick={() => onDistribute("y")}
          disabled={selectedCount < 3}
        />
        <Sep />
        <TB
          icon={Copy}
          label="Duplicar texto libre (Ctrl+D)"
          onClick={onDuplicate}
          disabled={none}
        />
        <TB
          icon={Trash2}
          label="Quitar campo(s) (Supr)"
          onClick={onRemove}
          disabled={none}
        />
        <Sep />
        <TB
          icon={Magnet}
          label={
            snapOn
              ? "Ajuste inteligente activado (Alt para omitir)"
              : "Ajuste inteligente desactivado"
          }
          onClick={onToggleSnap}
          active={snapOn}
        />
        <TB
          icon={Grid3x3}
          label="Cuadrícula de 5 mm"
          onClick={onToggleGrid}
          active={showGrid}
        />
        <TB
          icon={Ruler}
          label="Reglas (mm)"
          onClick={onToggleRulers}
          active={showRulers}
        />
        <span className="ml-auto pl-2 text-xs text-muted-foreground">
          {selectedCount === 0
            ? "Clic para seleccionar · Shift+clic para varios"
            : selectedCount === 1
              ? "1 campo · flechas para mover (Shift = 10 pt)"
              : `${selectedCount} campos seleccionados`}
        </span>
      </div>
    </TooltipProvider>
  );
}
