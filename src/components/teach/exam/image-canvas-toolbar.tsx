"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  ChevronDown,
  CopyPlus,
  Grid3x3,
  Magnet,
  Minus,
  MoveHorizontal,
  Plus,
  Redo2,
  Ruler,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ZOOM_MAX, ZOOM_MIN, gridStepFor, type AlignMode } from "@/lib/image-layout";
import { CropBar, PhotoButtons, type PhotoTools } from "./image-photo-tools";
import type { CanvasZoom } from "./use-canvas-zoom";

/**
 * Barra de herramientas sobre la foto de los editores de «arrastrar a la
 * imagen» y «señalar en la imagen»: Deshacer y Rehacer · (solo en arrastrar)
 * Duplicar, Alinear ▾ y Repartir ▾ · los interruptores Imán, Reglas y
 * Cuadrícula (recordados en este navegador, los mismos en los dos editores) ·
 * el zoom: −, el porcentaje, + y «Ajustar» · la foto: Recortar, Girar ⟲ ⟳ y
 * Cambiar (`image-photo-tools.tsx`). Mientras se recorta, en su lugar va la
 * barra del recorte (con el zoom). En pantallas angostas se acomoda en varias
 * filas. Lo que aún no aplica (alinear con menos de dos lugares, acercar más
 * allá del 400 %) no se deshabilita del todo: así el foco no se pierde, y al
 * pulsarlo se dice qué falta.
 */

export type CanvasPrefs = { magnet: boolean; rulers: boolean; grid: boolean };

const PREFS_KEY = "plataforma:lienzo-herramientas";
const DEFAULT_PREFS: CanvasPrefs = { magnet: true, rulers: true, grid: false };

/** Lo guardado en este navegador; sin nada (o sin acceso), lo de siempre. */
function readPrefs(): CanvasPrefs {
  // El editor solo se monta en el navegador (al abrir una pregunta): sin riesgo de hidratación
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? "null") as Partial<CanvasPrefs> | null;
    return {
      magnet: typeof raw?.magnet === "boolean" ? raw.magnet : DEFAULT_PREFS.magnet,
      rulers: typeof raw?.rulers === "boolean" ? raw.rulers : DEFAULT_PREFS.rulers,
      grid: typeof raw?.grid === "boolean" ? raw.grid : DEFAULT_PREFS.grid,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

/** Imán, reglas y cuadrícula, recordados en este navegador. */
export function useCanvasPrefs() {
  const [prefs, setPrefs] = useState<CanvasPrefs>(readPrefs);
  /** Lo último que eligió el maestro (no lo leído al abrir): solo eso se guarda. */
  const [chosen, setChosen] = useState<CanvasPrefs | null>(null);
  useEffect(() => {
    if (!chosen) return;
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(chosen));
    } catch {
      // Sin almacenamiento (modo privado estricto): vale solo mientras siga abierto
    }
  }, [chosen]);
  const toggle = (key: keyof CanvasPrefs) => {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    setChosen(next);
  };
  return { prefs, toggle };
}

const ALIGN_OPTIONS: { mode: AlignMode; label: string; said: string; icon: LucideIcon }[] = [
  { mode: "left", label: "Izquierda", said: "a la izquierda", icon: AlignStartVertical },
  { mode: "hcenter", label: "Centro", said: "al centro", icon: AlignCenterVertical },
  { mode: "right", label: "Derecha", said: "a la derecha", icon: AlignEndVertical },
  { mode: "top", label: "Arriba", said: "arriba", icon: AlignStartHorizontal },
  { mode: "vcenter", label: "En medio", said: "en medio", icon: AlignCenterHorizontal },
  { mode: "bottom", label: "Abajo", said: "abajo", icon: AlignEndHorizontal },
];

const DISTRIBUTE_OPTIONS: { axis: "x" | "y"; label: string; icon: LucideIcon }[] = [
  { axis: "x", label: "En horizontal", icon: AlignHorizontalDistributeCenter },
  { axis: "y", label: "En vertical", icon: AlignVerticalDistributeCenter },
];

/** Deshacer y Rehacer. Sin deshabilitar del todo: así el foco no se pierde al llegar al final. */
export function HistoryButtons({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}) {
  return (
    <div role="group" aria-label="Historial" className="flex items-center gap-1">
      <Button
        type="button"
        size="icon-sm"
        variant="outline"
        aria-label="Deshacer"
        aria-keyshortcuts="Control+Z"
        title="Deshacer (Ctrl+Z)"
        aria-disabled={!canUndo}
        className="aria-disabled:opacity-50"
        onClick={onUndo}
      >
        <Undo2 aria-hidden />
      </Button>
      <Button
        type="button"
        size="icon-sm"
        variant="outline"
        aria-label="Rehacer"
        aria-keyshortcuts="Control+Shift+Z Control+Y"
        title="Rehacer (Ctrl+Mayús+Z o Ctrl+Y)"
        aria-disabled={!canRedo}
        className="aria-disabled:opacity-50"
        onClick={onRedo}
      >
        <Redo2 aria-hidden />
      </Button>
    </div>
  );
}

/** Lo propio de «arrastrar»: duplicar, alinear y repartir los lugares seleccionados. */
export type ArrangeTools = {
  /** Lugares seleccionados. */
  count: number;
  onDuplicate: (viaKeyboard: boolean) => void;
  /** `said`: cómo se dice («a la izquierda»). */
  onAlign: (mode: AlignMode, said: string) => void;
  onDistribute: (axis: "x" | "y") => void;
};

export function CanvasToolbar({
  history,
  arrange,
  prefs,
  onToggle,
  zoom,
  photo,
  what = "lugares",
  announce,
}: {
  history: { canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void };
  /** Duplicar, alinear y repartir (sin esto, no se muestran: «señalar»). */
  arrange?: ArrangeTools;
  prefs: CanvasPrefs;
  onToggle: (key: keyof CanvasPrefs) => void;
  zoom: CanvasZoom;
  /** Recortar, girar y cambiar la foto. */
  photo: PhotoTools;
  /** Lo que se acomoda, para el título del imán («lugares», «puntos»). */
  what?: string;
  announce: (text: string) => void;
}) {
  const gridPct = Math.round(gridStepFor(zoom.zoom) * 100);
  if (photo.crop) return <CropBar photo={photo} zoom={<ZoomButtons zoom={zoom} announce={announce} />} />;
  return (
    <div
      role="group"
      aria-label="Herramientas de la foto"
      className="flex flex-wrap items-center gap-x-1 gap-y-1.5 rounded-xl border bg-muted/40 p-1.5"
    >
      <HistoryButtons canUndo={history.canUndo} canRedo={history.canRedo} onUndo={history.undo} onRedo={history.redo} />
      <Divider />
      {arrange && (
        <>
          <ArrangeButtons {...arrange} announce={announce} />
          <Divider />
        </>
      )}
      <div role="group" aria-label="Ayudas para acomodar" className="flex flex-wrap items-center gap-1">
        <Toggle
          on={prefs.magnet}
          icon={Magnet}
          label="Imán"
          title={`Imán: al mover${arrange ? " o estirar" : ""}, se pega a otros ${what}, a la foto y a la cuadrícula (Alt lo apaga mientras lo sostienes)`}
          onClick={() => onToggle("magnet")}
        />
        <Toggle on={prefs.rulers} icon={Ruler} label="Reglas" title="Reglas en la orilla de la foto" onClick={() => onToggle("rulers")} />
        <Toggle
          on={prefs.grid}
          icon={Grid3x3}
          label="Cuadrícula"
          title={`Cuadrícula cada ${gridPct} % (cada 5 % desde el 200 % de zoom)`}
          onClick={() => onToggle("grid")}
        />
      </div>
      <Divider />
      <ZoomButtons zoom={zoom} announce={announce} />
      <Divider />
      <PhotoButtons photo={photo} />
    </div>
  );
}

function ArrangeButtons({ count, onDuplicate, onAlign, onDistribute, announce }: ArrangeTools & { announce: (text: string) => void }) {
  return (
    <div role="group" aria-label="Acomodar lo seleccionado" className="flex flex-wrap items-center gap-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-keyshortcuts="Control+D"
        title="Duplicar lo seleccionado (Ctrl+D)"
        aria-disabled={count === 0}
        className="aria-disabled:opacity-50"
        onClick={(e) => onDuplicate(e.detail === 0)}
      >
        <CopyPlus aria-hidden />
        Duplicar
      </Button>
      <MenuButton
        label="Alinear"
        icon={AlignStartVertical}
        enabled={count >= 2}
        why="Selecciona al menos 2 lugares para alinearlos"
        announce={announce}
      >
        {ALIGN_OPTIONS.map(({ mode, label, said, icon: Icon }) => (
          <DropdownMenuItem key={mode} onSelect={() => onAlign(mode, said)}>
            <Icon aria-hidden />
            {label}
          </DropdownMenuItem>
        ))}
      </MenuButton>
      <MenuButton
        label="Repartir"
        icon={AlignHorizontalDistributeCenter}
        enabled={count >= 3}
        why="Selecciona al menos 3 lugares para repartirlos"
        announce={announce}
      >
        {DISTRIBUTE_OPTIONS.map(({ axis, label, icon: Icon }) => (
          <DropdownMenuItem key={axis} onSelect={() => onDistribute(axis)}>
            <Icon aria-hidden />
            {label}
          </DropdownMenuItem>
        ))}
      </MenuButton>
    </div>
  );
}

const zoomSaid = (z: number) => `${Math.round(z * 100)} %`;

/** Zoom: alejar, el porcentaje, acercar (niveles del 50 al 400 %) y «Ajustar» (al ancho: 100 %). */
function ZoomButtons({ zoom, announce }: { zoom: CanvasZoom; announce: (text: string) => void }) {
  const step = (dir: 1 | -1) => {
    const next = dir > 0 ? zoom.zoomIn() : zoom.zoomOut();
    announce(next === null ? `El zoom ya está en el ${dir > 0 ? "máximo" : "mínimo"}: ${zoomSaid(dir > 0 ? ZOOM_MAX : ZOOM_MIN)}` : `Zoom ${zoomSaid(next)}`);
  };
  return (
    <div role="group" aria-label="Zoom" className="flex items-center gap-0.5">
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label="Alejar"
        title="Alejar (también Ctrl+rueda sobre la foto)"
        aria-disabled={!zoom.canZoomOut}
        className="aria-disabled:opacity-50"
        onClick={() => step(-1)}
      >
        <Minus aria-hidden />
      </Button>
      {/* Sin región viva: cada cambio ya se dice con `announce` (y el pellizco daría muchos) */}
      <output aria-label="Zoom" aria-live="off" className="w-11 text-center text-xs font-bold tabular-nums">
        {zoomSaid(zoom.zoom)}
      </output>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label="Acercar"
        title="Acercar (también Ctrl+rueda sobre la foto; Espacio y arrastrar para moverte)"
        aria-disabled={!zoom.canZoomIn}
        className="aria-disabled:opacity-50"
        onClick={() => step(1)}
      >
        <Plus aria-hidden />
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        title="Ajustar la foto al ancho disponible (100 %)"
        onClick={() => {
          const next = zoom.fitWidth();
          announce(next === null ? "La foto ya está ajustada al ancho" : "Foto ajustada al ancho: zoom 100 %");
        }}
      >
        <MoveHorizontal aria-hidden />
        Ajustar
      </Button>
    </div>
  );
}

function Divider() {
  return <span aria-hidden className="mx-0.5 hidden h-5 w-px bg-border sm:block" />;
}

function Toggle({
  on,
  icon: Icon,
  label,
  title,
  onClick,
}: {
  on: boolean;
  icon: LucideIcon;
  label: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      aria-pressed={on}
      title={title}
      onClick={onClick}
      className="aria-pressed:border-primary/40 aria-pressed:bg-primary/10 aria-pressed:text-primary aria-pressed:hover:bg-primary/15 aria-pressed:hover:text-primary"
    >
      <Icon aria-hidden />
      {label}
    </Button>
  );
}

/** Botón con menú. Si aún no aplica, no se abre: dice qué falta. */
function MenuButton({
  label,
  icon: Icon,
  enabled,
  why,
  announce,
  children,
}: {
  label: string;
  icon: LucideIcon;
  enabled: boolean;
  why: string;
  announce: (text: string) => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // Si deja de aplicar con el menú abierto (se quitó la selección), se cierra y no se reabre solo
  if (open && !enabled) setOpen(false);
  return (
    <DropdownMenu
      open={open && enabled}
      onOpenChange={(next) => {
        if (next && !enabled) announce(why);
        setOpen(next && enabled);
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-disabled={!enabled}
          title={enabled ? label : why}
          className="aria-disabled:opacity-50"
        >
          <Icon aria-hidden />
          {label}
          <ChevronDown aria-hidden className="-mr-0.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-auto min-w-40"
        // El menú va en un portal, pero sus teclas suben por React hasta el editor: ahí no son atajos (Ctrl+Z, Supr…)
        onKeyDown={(e) => e.stopPropagation()}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
