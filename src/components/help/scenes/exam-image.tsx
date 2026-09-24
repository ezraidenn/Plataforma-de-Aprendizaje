"use client";

import { BoardSpot, SpotArea } from "@/components/exam/image-board";
import { IconArt, LabelPill, ZoneShadow } from "@/components/exam/image-pieces";
import { PRECISION_RADIUS } from "@/lib/image-questions";
import { iconBoxPx, type ElementView } from "@/lib/image-layout";
import { cn } from "@/lib/utils";
import { useSceneClock } from "../use-scene-clock";
import { MiniBadge } from "../mini/basics";
import { MiniCursor } from "../mini/cursor";
import {
  CLICK_MARKS,
  CLICK_PRECISION,
  CLICK_SPOTS,
  DRAG_PIECES,
  DRAG_ZONES,
  IMAGE_CLICK_CYCLE_MS,
  IMAGE_DRAG_CYCLE_MS,
  imageClickStory,
  imageDragStory,
} from "./exam-image.story";

/**
 * Preguntas sobre imagen. La «foto» es un plano dibujado; los lugares, las
 * fichas y los círculos de acierto son las mismas piezas que ve el alumno
 * (`src/components/exam/image-board.tsx` e `image-pieces.tsx`), a su tamaño
 * real. Los íconos son SVG propios como `data:` URL: se ven puros y las
 * sombras toman su silueta, igual que con un PNG subido.
 */

const PLAN_BG = "bg-[#f7f4ec]";
const WALL = "absolute bg-slate-600";
const FURNITURE = "absolute rounded-[2px] border border-slate-300 bg-white";
const ROOM = "absolute text-[7px] font-bold uppercase tracking-[0.1em] text-slate-400";

/**
 * Plano de una planta (oficina, pasillo y almacén) con dos salidas. Solo
 * dibujo. `leaves`: dibuja la hoja abierta de cada salida (en «arrastrar» no,
 * porque cruzaría el lugar de la etiqueta «Salida»).
 */
function FloorPlan({ leaves = false }: { leaves?: boolean }) {
  return (
    <div className={cn("absolute inset-0 overflow-hidden rounded-lg ring-1 ring-slate-300", PLAN_BG)}>
      <span className="absolute inset-x-[5%] bottom-[14%] top-[7%] border-[3px] border-slate-600" />
      {/* Muros interiores, cada uno con su puerta */}
      <span className={cn(WALL, "left-[38%] top-[7%] h-[38%] w-[3px]")} />
      <span className={cn(WALL, "bottom-[14%] left-[38%] top-[62%] w-[3px]")} />
      <span className={cn(WALL, "left-[72%] top-[7%] h-[13%] w-[3px]")} />
      <span className={cn(WALL, "bottom-[14%] left-[72%] top-[36%] w-[3px]")} />
      {/* Salidas: hueco en el muro y la hoja abierta */}
      <span className={cn("absolute bottom-[14%] left-[47%] h-[3px] w-[10%]", PLAN_BG)} />
      <span className={cn("absolute right-[5%] top-[52%] h-[16%] w-[3px]", PLAN_BG)} />
      {leaves && (
        <>
          <span className="absolute bottom-[14%] left-[47%] h-[1.5px] w-[8%] origin-left rotate-[-55deg] bg-slate-500" />
          <span className="absolute right-[5%] top-[52%] h-[14%] w-[1.5px] origin-top rotate-[55deg] bg-slate-500" />
        </>
      )}
      {/* Muebles */}
      <span className={cn(FURNITURE, "left-[22%] top-[15%] h-[18%] w-[12%]")} />
      <span className={cn(FURNITURE, "left-[26.5%] top-[36%] size-2 rounded-full")} />
      <span className={cn(FURNITURE, "left-[77%] top-[26%] h-[34%] w-[4%]")} />
      <span className={cn(FURNITURE, "left-[88%] top-[26%] h-[34%] w-[4%]")} />
      <span className={cn(ROOM, "left-[7%] top-[10%]")}>Oficina</span>
      <span className={cn(ROOM, "left-[40%] top-[10%]")}>Pasillo</span>
      <span className={cn(ROOM, "left-[74%] top-[10%]")}>Almacén</span>
    </div>
  );
}

// ─── Arrastrar a la imagen ────────────────────────────────────────────────────

const DRAG_PHOTO_H = 106;
const BANK_GAP = 6;
const BANK_H = 58;
/** Centro de la fila de fichas, medido desde el borde de arriba del banco */
const BANK_ROW_Y = 39;
/** Fichas del banco, en coordenadas del plano (el banco queda debajo: y > 1) */
const BANK_Y = (DRAG_PHOTO_H + BANK_GAP + BANK_ROW_Y) / DRAG_PHOTO_H;
const BANK_X = [0.12, 0.34, 0.58, 0.82];
const LABEL_PX = 11;
/** Ancho de referencia del plano: los tamaños de las fichas son relativos a él, como en una pregunta. */
const PLAN_W = 320;

/**
 * Los íconos de la escena, ya «recortados» a su dibujo como los que sube el
 * maestro (el viewBox abarca solo el dibujo, así su caja tiene su proporción).
 */
const EXTINGUISHER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="7.5 4.5 12.5 17.5" width="125" height="175">
<path d="M13 6.2h3.6l2.6 3.3" fill="none" stroke="#0f172a" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
<rect x="10" y="4.5" width="4" height="3.5" rx="1" fill="#0f172a"/>
<rect x="7.5" y="7.5" width="9" height="14.5" rx="3" fill="#dc2626"/>
<rect x="9.5" y="12" width="5" height="4" rx="1" fill="#fff" opacity="0.85"/>
</svg>`;
const FIRST_AID_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="3 3.7 18 16.8" width="180" height="168">
<path d="M9 6.5V4.5h6v2" fill="none" stroke="#15803d" stroke-width="1.6"/>
<rect x="3" y="6.5" width="18" height="14" rx="2.5" fill="#16a34a"/>
<path d="M12 10v7M8.5 13.5h7" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>
</svg>`;

/** Un ícono de la escena: su dibujo como URL (sirve de imagen y de máscara), proporción y ancho. */
type SceneIcon = { src: string; ratio: number; size: number };
const sceneIcon = (svg: string, ratio: number, widthPx: number): SceneIcon => ({
  src: `data:image/svg+xml,${encodeURIComponent(svg)}`,
  ratio,
  size: widthPx / PLAN_W,
});
/** Dibujo de cada ficha, en el orden de DRAG_PIECES (las de texto no tienen). */
const ICONS: (SceneIcon | null)[] = [sceneIcon(EXTINGUISHER_SVG, 17.5 / 12.5, 24), null, sceneIcon(FIRST_AID_SVG, 16.8 / 18, 28), null];

/** Revisión: contorno de un ícono bien o mal puesto, en los colores de la escena. */
const RESULT_COLOR = { ok: "#16a34a", bad: "#ef4444" };

/** Lo que se toma en la mano, para las sombras: su forma, tamaño y proporción. */
function heldShape(index: number): ElementView {
  const piece = DRAG_PIECES[index];
  const icon = ICONS[index];
  return piece.kind === "text" || !icon
    ? { kind: "text", text: piece.label, size: LABEL_PX / PLAN_W, ratio: 1, rotation: 0 }
    : { kind: "icon", size: icon.size, ratio: icon.ratio, rotation: 0 };
}

/**
 * Cara de la ficha: el ícono puro (solo el dibujo, con su sombra suave) o la
 * etiqueta real. Al calificar, el ícono lleva un contorno verde o rojo que
 * sigue su silueta y la etiqueta un anillo, como en la revisión.
 */
function PieceFace({ index, result = null, className }: { index: number; result?: boolean | null; className?: string }) {
  const piece = DRAG_PIECES[index];
  const icon = ICONS[index];
  if (piece.kind === "text" || !icon) {
    return (
      <LabelPill
        text={piece.label}
        fontPx={LABEL_PX}
        dense
        className={cn(result !== null && (result ? "ring-2 ring-green-600" : "ring-2 ring-red-500"), className)}
      />
    );
  }
  const { w, h } = iconBoxPx(icon.size, icon.ratio, PLAN_W);
  return (
    <IconArt
      src={icon.src}
      w={w}
      h={h}
      outline={result === null ? undefined : RESULT_COLOR[result ? "ok" : "bad"]}
      className={className}
    />
  );
}

/**
 * Arrastrar a la imagen: tres lugares idénticos. Al tomar el ícono todos los
 * libres toman su silueta (la del extintor); al tomar la etiqueta, píldoras.
 * La ficha cruza hasta su lugar, este se ilumina y encaja. Al final, 2 de 3.
 */
export function ImageDragScene() {
  const phase = useSceneClock(IMAGE_DRAG_CYCLE_MS);
  const s = imageDragStory(phase);
  const held = s.held !== null ? heldShape(s.held) : null;
  const percent = Math.round((s.ok / s.total) * 100);

  return (
    <div className="absolute inset-0 flex flex-col gap-1.5 bg-white p-2.5 text-[11px]">
      <b className="text-[11.5px] leading-snug">Coloca cada señal en su lugar del plano</b>
      <div className="mx-auto w-full max-w-[320px] shrink-0">
        <div className="relative" style={{ height: DRAG_PHOTO_H }}>
          <FloorPlan />

          {DRAG_ZONES.map((zone, z) => {
            if (s.shadows[z] === null) return null; // tiene ficha: se dibuja abajo
            return (
              <BoardSpot key={z} x={zone.x} y={zone.y}>
                {s.graded ? (
                  // Vacío al calificar: como en la revisión, en rojo punteado
                  <span className="block size-[34px] animate-in fade-in rounded-full border-2 border-dashed border-red-500 bg-red-500/10 duration-300" />
                ) : (
                  <ZoneShadow
                    shape={held}
                    silhouette={s.held !== null ? ICONS[s.held]?.src : undefined}
                    hot={s.hot === z}
                    boardWidth={PLAN_W}
                    dense
                    tabIndex={-1}
                    className="pointer-events-none"
                  />
                )}
              </BoardSpot>
            );
          })}

          {/* Al tomar una ficha sale una copia: la del banco queda atenuada */}
          {s.held !== null && (
            <BoardSpot x={BANK_X[s.held]} y={BANK_Y}>
              <PieceFace index={s.held} className="opacity-35" />
            </BoardSpot>
          )}

          {DRAG_PIECES.map((piece, i) => {
            const zone = s.placed.indexOf(i);
            const inHand = s.held === i;
            const at =
              zone >= 0
                ? DRAG_ZONES[zone]
                : inHand && s.travelling && s.target !== null
                  ? DRAG_ZONES[s.target]
                  : { x: BANK_X[i], y: BANK_Y };
            const result = s.graded && zone >= 0 ? s.correct[zone] : null;
            return (
              <BoardSpot
                key={piece.label}
                x={at.x}
                y={at.y}
                className={cn("transition-[left,top] duration-[600ms] ease-in-out", inHand ? "z-20" : "z-10")}
              >
                <span
                  className={cn(
                    "relative block transition-transform duration-300",
                    // En la mano va levantada (con una sombra que sigue su forma); sobre
                    // el lugar, un poco corrida para que se vea iluminado
                    inHand &&
                      cn(
                        "drop-shadow-[0_8px_8px_rgb(15_23_42/0.3)]",
                        s.travelling ? "translate-x-2 -translate-y-2.5 -rotate-3 scale-110" : "-translate-y-1 -rotate-3 scale-110"
                      )
                  )}
                >
                  <PieceFace index={i} result={result} />
                  {inHand && <MiniCursor at pressed />}
                  {result && (
                    <span className="absolute -right-1.5 -top-1.5 flex size-3.5 animate-in zoom-in items-center justify-center rounded-full bg-green-600 text-[8px] font-black text-white ring-2 ring-white duration-300">
                      ✓
                    </span>
                  )}
                </span>
              </BoardSpot>
            );
          })}
        </div>

        <div
          className="flex items-start justify-between gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-100/70 px-2 pt-1"
          style={{ marginTop: BANK_GAP, height: BANK_H }}
        >
          {s.graded ? (
            <span className="flex h-[18px] items-center text-[9.5px] leading-none text-slate-600">El lugar vacío cuenta cero.</span>
          ) : (
            <span className="flex h-[18px] items-center text-[8.5px] font-extrabold uppercase tracking-[0.08em] text-slate-500">
              Arrastra a su lugar
            </span>
          )}
          {s.graded && (
            <MiniBadge tone="warn" className="shrink-0 whitespace-nowrap leading-[14px]">
              {s.ok} de {s.total} lugares → {percent}%
            </MiniBadge>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Señalar en la imagen ─────────────────────────────────────────────────────

/** Con 294 px de ancho (el «?») da la proporción CLICK_ASPECT de la historia. */
const CLICK_PHOTO_H = 150;

/**
 * Señalar en la imagen: el alumno pone sus dos marcas numeradas; luego
 * aparecen los círculos de acierto (verde: dentro; rojo: fuera). 1 de 2.
 */
export function ImageClickScene() {
  const phase = useSceneClock(IMAGE_CLICK_CYCLE_MS);
  const s = imageClickStory(phase);
  const target = CLICK_MARKS[s.cursorAt];
  const percent = Math.round((s.ok / s.total) * 100);

  return (
    <div className="absolute inset-0 flex flex-col gap-1.5 bg-white p-2.5 text-[11px]">
      <b className="text-[11.5px] leading-snug">Señala las 2 salidas de emergencia</b>
      <div className="relative mx-auto w-full max-w-[320px] shrink-0" style={{ height: CLICK_PHOTO_H }}>
        <FloorPlan leaves />
        {s.revealed &&
          CLICK_SPOTS.map((spot, i) => (
            <div key={i} className="animate-in fade-in duration-500">
              <SpotArea x={spot.x} y={spot.y} radius={PRECISION_RADIUS[CLICK_PRECISION]} missed={!s.hits[i]} />
            </div>
          ))}
        {CLICK_MARKS.slice(0, s.marks).map((mark, i) => (
          <BoardSpot key={i} x={mark.x} y={mark.y} className="z-10">
            <span className="flex size-5 animate-in zoom-in items-center justify-center rounded-full bg-cta text-[10px] font-bold text-white shadow ring-2 ring-white duration-300">
              {i + 1}
            </span>
          </BoardSpot>
        ))}
        <BoardSpot x={target.x} y={target.y} className="z-20 size-0 transition-[left,top] duration-700 ease-in-out">
          <MiniCursor at={s.cursorVisible} pressed={s.pressed} />
        </BoardSpot>
      </div>
      <div className="mt-auto flex items-center justify-between gap-2">
        <span className="text-[9.5px] leading-snug text-slate-500">
          {s.graded
            ? "La marca 2 cayó fuera."
            : s.revealed
              ? "Círculos de acierto · precisión normal"
              : `${s.marks} de ${s.total} marcas`}
        </span>
        {s.graded && (
          <MiniBadge tone="warn" className="shrink-0 whitespace-nowrap">
            {s.ok} de {s.total} puntos → {percent}%
          </MiniBadge>
        )}
      </div>
    </div>
  );
}
