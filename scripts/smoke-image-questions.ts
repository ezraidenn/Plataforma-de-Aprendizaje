/**
 * Preguntas sobre imagen (arrastrar y señalar): matemática pura, validación y
 * el recorrido completo contra la base (guardar, la vista previa del maestro,
 * lo que recibe el alumno, calificar, revisar). Datos con prefijo «zimg»,
 * borrados al final.
 *
 * Uso: pnpm smoke:image
 */
import { Readable } from "node:stream";
import sharp from "sharp";
import { and, eq, inArray, like, or } from "drizzle-orm";
import { db } from "../src/server/db";
import { attemptAnswers, auditLog, courses as coursesTable, files, notifications, users } from "../src/server/db/schema";
import * as courses from "../src/server/services/courses";
import * as tree from "../src/server/services/tree";
import * as examsSvc from "../src/server/services/exams";
import { buildReview, imageAnswerSummary } from "../src/server/services/exam-review";
import { exportExamCsv, countImageQuestions } from "../src/server/services/exam-csv";
import { importQuestionInputs } from "../src/server/services/exam-import";
import { parseCsv } from "../src/server/services/csv-core";
import { deleteFile, saveStream } from "../src/server/services/storage";
import { buildRunnerQuestions } from "../src/components/student/lesson-data";
import { cleanupSmokeNotifications } from "./lib/smoke-cleanup";
import { imagePreview, questionsToPreview } from "../src/lib/preview-question";
import { clickReviewBoard, dragReviewBoard } from "../src/lib/image-boards";
import {
  MAX_SPOTS,
  MIN_ZONE_GAP,
  PRECISION_RADIUS,
  SNAP_RADIUS,
  dragCopies,
  freeSpot,
  imageClickHits,
  imageClickProblem,
  imageClickScore,
  imageDragProblem,
  overlapNumbers,
  imageDragScore,
  iconNumbers,
  nearestZone,
  parseClickAnswer,
  readingNumbers,
  readingOrder,
  parseDragAnswer,
  isImageQuestionType,
  readImageClick,
  readImageDrag,
  relDistance,
  sanitizeImageConfig,
  type ImageClickConfig,
  type ImageDragConfig,
} from "../src/lib/image-questions";
import { imageEditorProblem, initialImageValue, shapedImageValue } from "../src/lib/image-editor-value";
import {
  DEFAULT_ICON_SIZE,
  DEFAULT_TEXT_SIZE,
  alignDeltas,
  alphaBounds,
  boxBounds,
  boxesOverlap,
  distributeDeltas,
  elementBox,
  elementRatio,
  elementSize,
  elementView,
  iconBoxPx,
  iconSizeRange,
  normalizeRotation,
  shownAtMinimum,
  gridStepFor,
  snapMove,
  snapRadiusFor,
  snapScale,
  snapSpot,
  snapToGrid,
  textPx,
  unionBounds,
  wheelZoom,
  zoomStep,
  type Bounds,
} from "../src/lib/image-layout";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  }
}

const DRAG: ImageDragConfig = {
  aspect: 0.75,
  iconSize: "md",
  elements: [
    { id: "ext", kind: "icon", fileId: "f-ext" },
    { id: "sal", kind: "icon", fileId: "f-sal" },
    { id: "reu", kind: "text", text: "Punto de reunión" },
    { id: "reg", kind: "text", text: "Regadera" }, // distractor: sin lugar
  ],
  zones: [
    { x: 0.2, y: 0.3, elementId: "ext" },
    { x: 0.6, y: 0.3, elementId: "ext" },
    { x: 0.9, y: 0.8, elementId: "sal" },
    { x: 0.3, y: 0.8, elementId: "reu" },
  ],
};

const CLICK: ImageClickConfig = { aspect: 0.5, precision: "md", spots: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.6 }] };

function mathChecks() {
  console.log("\n— Matemática");
  const copies = dragCopies(DRAG);
  check("Copias: el extintor va dos veces, los demás una, el distractor una", copies.length === 5 &&
    copies.filter((c) => c.elementId === "ext").length === 2 &&
    copies.filter((c) => c.elementId === "reg").length === 1, copies);

  check("Todo bien puesto: 1", imageDragScore(DRAG, ["ext", "ext", "sal", "reu"]) === 1);
  check("Un distractor cuenta como error", imageDragScore(DRAG, ["reg", "ext", "sal", "reu"]) === 0.75);
  check("Lugar vacío cuenta cero", imageDragScore(DRAG, [undefined, "ext", undefined, "reu"]) === 0.5);
  check("Sin lugares: 0", imageDragScore({ ...DRAG, zones: [] }, []) === 0);

  check("Distancia corrige la proporción", Math.abs(relDistance({ x: 0, y: 0 }, { x: 0, y: 1 }, 0.5) - 0.5) < 1e-9);
  const r = PRECISION_RADIUS.md;
  check("Marca dentro del radio acierta", imageClickScore(CLICK, [{ x: 0.2 + r * 0.9, y: 0.2 }, { x: 0.8, y: 0.6 }]) === 1);
  check("Marca fuera del radio no acierta", imageClickScore(CLICK, [{ x: 0.2 + r * 1.2, y: 0.2 }, { x: 0.8, y: 0.6 }]) === 0.5);
  check("Dos marcas en el mismo punto solo acreditan uno", imageClickScore(CLICK, [{ x: 0.2, y: 0.2 }, { x: 0.21, y: 0.2 }]) === 0.5);
  check("Marcas de más se ignoran", imageClickScore(CLICK, [{ x: 0, y: 0 }, { x: 0.01, y: 0 }, { x: 0.2, y: 0.2 }]) === 0);
  check("Sin marcas: 0", imageClickScore(CLICK, []) === 0);
  check("Aciertos por punto", JSON.stringify(imageClickHits(CLICK, [{ x: 0.8, y: 0.6 }, { x: 0, y: 0 }])) === "[false,true]");
  // Emparejamiento: la marca A alcanza los dos puntos, la B solo el primero; con
  // reparto ingenuo A se queda el primero y B no suma. Bien hecho, suman los dos.
  const NEAR: ImageClickConfig = { aspect: 1, precision: "lg", spots: [{ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.5 }] };
  check("Emparejamiento máximo", imageClickScore(NEAR, [{ x: 0.55, y: 0.5 }, { x: 0.45, y: 0.5 }]) === 1);

  const zones = DRAG.zones.map(({ x, y }) => ({ x, y }));
  check("Encaje: la sombra más cercana dentro del radio", nearestZone(zones, { x: 0.22, y: 0.31 }, DRAG.aspect) === 0);
  check("Encaje: lejos de todas, ninguna", nearestZone(zones, { x: 0.45, y: 0.55 }, DRAG.aspect) === null);
  check("Encaje: con dos a la mano, la más cercana", nearestZone([{ x: 0.5, y: 0.5 }, { x: 0.56, y: 0.5 }], { x: 0.54, y: 0.5 }, 1) === 1);
  check("Radio de encaje razonable", SNAP_RADIUS > 0 && SNAP_RADIUS < 0.2);

  // Editor: un lugar soltado encima de otro se corre lo justo
  const others = [{ x: 0.5, y: 0.5 }, { x: 0.56, y: 0.5 }];
  const clearOf = (list: { x: number; y: number }[], p: { x: number; y: number } | null, aspect: number) =>
    !!p && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1 && list.every((o) => relDistance(o, p, aspect) >= MIN_ZONE_GAP);
  const free = { x: 0.1, y: 0.1 };
  check("Lugar libre: queda donde se soltó", freeSpot(free, others, 0.75) === free);
  const pushed = freeSpot({ x: 0.52, y: 0.5 }, others, 0.75);
  check("Lugar encimado: se corre, libre y cerca", clearOf(others, pushed, 0.75) && relDistance({ x: 0.52, y: 0.5 }, pushed!, 0.75) <= MIN_ZONE_GAP * 1.5, pushed);
  const corner = freeSpot({ x: 0, y: 0 }, [{ x: 0, y: 0 }], 1);
  check("Encimado en la esquina: se corre sin salirse de la foto", clearOf([{ x: 0, y: 0 }], corner, 1), corner);
  const packed = Array.from({ length: 51 * 51 }, (_, i) => ({ x: (i % 51) * 0.02, y: Math.floor(i / 51) * 0.02 }));
  check("Foto llena de lugares: no hay dónde, null", freeSpot({ x: 0.5, y: 0.5 }, packed, 1) === null);

  // «Lugar N»: por filas y de izquierda a derecha, venga en el orden que venga
  const pts = [{ x: 0.9, y: 0.51 }, { x: 0.1, y: 0.5 }, { x: 0.5, y: 0.1 }, { x: 0.2, y: 0.8 }];
  const order = (p: { x: number; y: number }[]) => readingOrder(p, 0.75).map((q) => `${q.x},${q.y}`).join(" ");
  check("Orden de lectura por filas", order(pts) === "0.5,0.1 0.1,0.5 0.9,0.51 0.2,0.8", order(pts));
  check("Orden de lectura igual con la entrada revuelta", order([...pts].reverse()) === order(pts));
  check("Número de lectura de cada punto, en el orden en que llegan", readingNumbers(pts, 0.75).join() === "3,2,1,4", readingNumbers(pts, 0.75));
  const icons = iconNumbers(["f-b", "f-a", undefined, "f-b"]);
  check("«Ícono N» por archivo en orden fijo", icons.get("f-a") === 1 && icons.get("f-b") === 2 && icons.size === 2);

  check("Respuesta de arrastre ilegible: vacía", Object.keys(parseDragAnswer("{no json")).length === 0);
  check("Respuesta de arrastre solo con textos", JSON.stringify(parseDragAnswer('{"a":"b","c":3}')) === '{"a":"b"}');
  check("Respuesta de clic: recorta al máximo y descarta basura", parseClickAnswer('[{"x":0.1,"y":0.2},{"x":"a","y":1},{"x":0.5,"y":0.5},{"x":0.9,"y":0.9}]', 2).length === 2);
  check("Respuesta de clic: fuera de 0–1 se descarta", parseClickAnswer('[{"x":1.5,"y":0.2}]', 5).length === 0);
}

function validationChecks() {
  console.log("\n— Validación");
  check("Arrastre válido", imageDragProblem(DRAG, true) === null, imageDragProblem(DRAG, true));
  check("Sin foto", imageDragProblem(DRAG, false) === "Sube la foto de la pregunta");
  check("Sin lugares", imageDragProblem({ ...DRAG, zones: [] }, true) === "Coloca al menos un elemento en la foto");
  check("Ícono sin archivo", imageDragProblem({ ...DRAG, elements: [...DRAG.elements, { id: "x", kind: "icon" }] }, true) === "Hay un ícono sin imagen");
  check("Texto vacío", imageDragProblem({ ...DRAG, elements: [...DRAG.elements, { id: "y", kind: "text", text: "  " }] }, true) === "Hay una etiqueta sin texto");
  check("Lugar de un elemento que no existe", imageDragProblem({ ...DRAG, zones: [{ x: 0.1, y: 0.1, elementId: "nada" }] }, true) !== null);
  check("Coordenadas fuera de la foto", imageDragProblem({ ...DRAG, zones: [{ x: 1.2, y: 0.1, elementId: "ext" }] }, true) !== null);
  const twin = "Hay dos elementos iguales: deja uno y colócalo en varios lugares";
  check("Dos íconos con el mismo archivo", imageDragProblem({ ...DRAG, elements: [...DRAG.elements, { id: "ext2", kind: "icon", fileId: "f-ext" }] }, true) === twin);
  check("Dos etiquetas iguales (sin distinguir mayúsculas ni espacios)", imageDragProblem({ ...DRAG, elements: [...DRAG.elements, { id: "reg2", kind: "text", text: " REGADERA " }] }, true) === twin);
  check("Demasiados elementos", imageDragProblem({ ...DRAG, elements: Array.from({ length: 21 }, (_, i) => ({ id: `e${i}`, kind: "text" as const, text: "t" })) }, true) !== null);
  check("Config ilegible", imageDragProblem(null, true) !== null);
  const stacked = "Hay dos lugares encimados: sepáralos un poco";
  const withZone = (x: number, y: number) => ({ ...DRAG, zones: [...DRAG.zones, { x, y, elementId: "sal" }] });
  check("Dos lugares encimados", imageDragProblem(withZone(0.2 + MIN_ZONE_GAP / 2, 0.3), true) === stacked);
  check("Encimados en vertical: cuenta la proporción", imageDragProblem(withZone(0.2, 0.3 + 0.045), true) === stacked);
  check("Separados lo justo: válido", imageDragProblem(withZone(0.2 + MIN_ZONE_GAP + 0.001, 0.3), true) === null);
  const near = withZone(0.2 + MIN_ZONE_GAP / 2, 0.3);
  check("Encimados: sus números de lectura", JSON.stringify(overlapNumbers(near.zones, near.aspect)) === "[1,2]", overlapNumbers(near.zones, near.aspect));
  const said = imageEditorProblem("image_drag", { imageFileId: "f", config: near });
  check("El editor dice cuáles están encimados", said === "Los lugares 1 y 2 están encimados: sepáralos un poco para poder guardar", said);
  check("El editor dice lo mismo que el servidor si no son encimados", imageEditorProblem("image_drag", { imageFileId: "f", config: { ...DRAG, zones: [] } }) === "Coloca al menos un elemento en la foto");
  const odd = (e: unknown) => {
    try {
      return imageDragProblem({ ...DRAG, elements: [...DRAG.elements, e] }, true);
    } catch {
      return "lanzó";
    }
  };
  check("Etiqueta con texto que no es texto: problema, sin lanzar", odd({ id: "n", kind: "text", text: 123 }) === "Hay una etiqueta sin texto", odd({ id: "n", kind: "text", text: 123 }));
  check("Ícono con archivo que no es texto: problema, sin lanzar", odd({ id: "m", kind: "icon", fileId: 5 }) === "Hay un ícono sin imagen", odd({ id: "m", kind: "icon", fileId: 5 }));
  check("Señalar válido", imageClickProblem(CLICK, true) === null, imageClickProblem(CLICK, true));
  check("Señalar sin puntos", imageClickProblem({ ...CLICK, spots: [] }, true) === "Marca al menos un punto en la foto");
  check(`Señalar con ${MAX_SPOTS + 1} puntos`, imageClickProblem({ ...CLICK, spots: Array.from({ length: MAX_SPOTS + 1 }, () => ({ x: 0.5, y: 0.5 })) }, true) === `Usa como máximo ${MAX_SPOTS} puntos`);
  check("Proporción inválida", imageClickProblem({ ...CLICK, aspect: 0 }, true) !== null);
}

function layoutChecks() {
  console.log("\n— Tamaño, proporción y giro");
  check("Ícono viejo sin size: sale de iconSize", Math.abs(elementSize({ kind: "icon" }, "md") - 56 / 700) < 1e-9);
  check("Ícono viejo sin size ni iconSize: mediano", Math.abs(elementSize({ kind: "icon" }) - DEFAULT_ICON_SIZE) < 1e-9);
  check("Texto sin size: letra por defecto", elementSize({ kind: "text" }) === DEFAULT_TEXT_SIZE);
  check("Con size: el suyo", elementSize({ kind: "icon", size: 0.2 }, "sm") === 0.2);
  check("Proporción: la del ícono, 1 si falta o es inválida", elementRatio({ kind: "icon", ratio: 0.5 }) === 0.5 && elementRatio({ kind: "icon" }) === 1 && elementRatio({ kind: "icon", ratio: -2 }) === 1 && elementRatio({ kind: "text", ratio: 3 }) === 1);
  check("Giro normalizado a (-180, 180]", normalizeRotation(190) === -170 && normalizeRotation(-180) === 180 && normalizeRotation(540) === 180 && normalizeRotation(-30) === -30);
  const view = elementView({ id: "a", kind: "icon", fileId: "f", size: 0.1, ratio: 2, rotation: 45 }, "md");
  check("Vista de un elemento: sin id y con todo resuelto", JSON.stringify(view) === JSON.stringify({ kind: "icon", fileId: "f", size: 0.1, ratio: 2, rotation: 45 }), view);
  check("Vista de un texto viejo: letra por defecto y giro 0", JSON.stringify(elementView({ id: "t", kind: "text", text: "Hola" })) === JSON.stringify({ kind: "text", text: "Hola", size: DEFAULT_TEXT_SIZE, ratio: 1, rotation: 0 }));
  check("Píxeles de un ícono: el tamaño es su lado mayor (ancho)", JSON.stringify(iconBoxPx(0.1, 0.5, 800)) === JSON.stringify({ w: 80, h: 40 }), iconBoxPx(0.1, 0.5, 800));
  check("Píxeles de un ícono alto (ratio 4, size 0.2): w = 0.05·W, h = 0.2·W", JSON.stringify(iconBoxPx(0.2, 4, 800)) === JSON.stringify({ w: 40, h: 160 }), iconBoxPx(0.2, 4, 800));
  check("Mismo tamaño, cualquier forma: el lado mayor mide lo mismo", [0.1, 0.4, 1, 2.5, 10].every((r) => { const b = iconBoxPx(0.1, r, 800); return Math.max(b.w, b.h) === 80; }));
  check("Píxeles de un ícono: mínimo de 24 px en el lado mayor",
    JSON.stringify(iconBoxPx(0.02, 1, 390)) === JSON.stringify({ w: 24, h: 24 }) &&
      JSON.stringify(iconBoxPx(0.02, 0.25, 390)) === JSON.stringify({ w: 24, h: 6 }) &&
      JSON.stringify(iconBoxPx(0.02, 4, 390)) === JSON.stringify({ w: 6, h: 24 }),
    [iconBoxPx(0.02, 0.25, 390), iconBoxPx(0.02, 4, 390)]);
  check("Se ve al mínimo: ícono bajo 24 px o letra bajo 11 px en ese ancho",
    shownAtMinimum("icon", 0.02, 390) && !shownAtMinimum("icon", 0.08, 390) && shownAtMinimum("text", 0.02, 390) && !shownAtMinimum("text", 0.02, 800) && !shownAtMinimum("icon", 0.02, 0));
  check("Letra: tamaño × ancho, mínimo 11 px", textPx(0.02, 800) === 16 && textPx(0.02, 390) === 11);
  check("Radio de encaje: al menos SNAP_RADIUS, o la mitad del elemento", snapRadiusFor(0.04) === SNAP_RADIUS && snapRadiusFor(0.3) === 0.15);
  check("Tamaños del editor: 2–50 % en fotos comunes; en una panorámica, el lado mayor cabe en el 90 % del alto",
    JSON.stringify(iconSizeRange(800 / 1200)) === JSON.stringify([0.02, 0.5]) &&
      JSON.stringify(iconSizeRange(9 / 16)) === JSON.stringify([0.02, 0.5]) &&
      JSON.stringify(iconSizeRange(1.5)) === JSON.stringify([0.02, 0.5]) &&
      JSON.stringify(iconSizeRange(0.3)) === JSON.stringify([0.02, 0.27]) &&
      JSON.stringify(iconSizeRange(0.1)) === JSON.stringify([0.02, 0.09]) &&
      JSON.stringify(iconSizeRange(Number.NaN)) === JSON.stringify([0.02, 0.5]),
    [iconSizeRange(0.3), iconSizeRange(0.1)]);
  // Caja: ancho en fracciones del ancho; alto en fracciones del alto
  const b = elementBox({ x: 0.5, y: 0.5 }, { w: 0.2, h: 0.2 * 0.5 }, 0, 0.5);
  check("Caja sin giro", JSON.stringify(boxBounds(b)) === JSON.stringify({ left: 0.4, right: 0.6, top: 0.4, bottom: 0.6 }), boxBounds(b));
  const r = boxBounds(elementBox({ x: 0.5, y: 0.5 }, { w: 0.2, h: 0.1 }, 90, 1));
  check("Caja girada 90°: intercambia ancho y alto", Math.abs(r.right - r.left - 0.1) < 1e-9 && Math.abs(r.bottom - r.top - 0.2) < 1e-9, r);
  // Límites del dibujo: 4×3 con un solo píxel opaco en (2,1)
  const rgba = new Uint8ClampedArray(4 * 3 * 4);
  rgba[(1 * 4 + 2) * 4 + 3] = 255;
  check("Límites del dibujo", JSON.stringify(alphaBounds(rgba, 4, 3)) === JSON.stringify({ x: 2, y: 1, w: 1, h: 1 }));
  check("Límites: todo transparente, null", alphaBounds(new Uint8ClampedArray(16), 2, 2) === null);
  check("Límites: casi transparente (alfa ≤ 8) no cuenta", (() => { const a = new Uint8ClampedArray(16); a[3] = 8; return alphaBounds(a, 2, 2) === null; })());

  console.log("\n— Editor: cajas que se tapan");
  const sq = (x: number, y: number, rotation = 0, side = 0.1) => elementBox({ x, y }, { w: side, h: side }, rotation, 1);
  check("Cajas separadas no se tapan", !boxesOverlap(sq(0.2, 0.5), sq(0.35, 0.5)));
  check("Cajas encimadas se tapan", boxesOverlap(sq(0.2, 0.5), sq(0.28, 0.52)));
  check("Tocarse por un borde no cuenta", !boxesOverlap(sq(0.2, 0.5), sq(0.3, 0.5)));
  // Dos rombos (cuadrados a 45°) en diagonal: sus cajas envolventes se enciman, ellos no
  const [d1, d2] = [sq(0.2, 0.2, 45), sq(0.325, 0.325, 45)];
  const [e1, e2] = [boxBounds(d1), boxBounds(d2)];
  const envelopes = e1.left < e2.right && e2.left < e1.right && e1.top < e2.bottom && e2.top < e1.bottom;
  check("Con giro: se mide la caja girada, no la envolvente", envelopes && !boxesOverlap(d1, d2));
  // Una barra larga girada 90° alcanza a la de abajo; sin girar, no
  const bar = (x: number, y: number, rotation: number) => elementBox({ x, y }, { w: 0.3, h: 0.03 }, rotation, 1);
  check("Con giro: una barra vertical alcanza lo que la horizontal no", boxesOverlap(bar(0.5, 0.36, 90), bar(0.5, 0.5, 0)) && !boxesOverlap(bar(0.5, 0.36, 0), bar(0.5, 0.5, 0)));
  // En la foto (no cuadrada) el alto se mide con la proporción
  const tall = (y: number) => elementBox({ x: 0.5, y }, { w: 0.1, h: 0.1 }, 0, 0.5);
  check("Con la proporción de la foto: 0.1 de alto a lo ancho son 0.2 del alto", boxesOverlap(tall(0.3), tall(0.49)) && !boxesOverlap(tall(0.3), tall(0.51)));

  console.log("\n— Editor: abrir una pregunta y conservarla");
  const opened = initialImageValue("image_drag", "foto", { ...DRAG, iconSize: "lg" }).config as ImageDragConfig;
  check("Pregunta de antes: iconSize pasa a cada elemento y ya no sigue",
    !("iconSize" in opened) &&
      opened.elements.every((e) => typeof e.size === "number") &&
      opened.elements.find((e) => e.kind === "icon")?.size === Math.round((72 / 700) * 10_000) / 10_000 &&
      opened.elements.find((e) => e.kind === "text")?.size === DEFAULT_TEXT_SIZE,
    opened.elements);
  check("Pregunta de antes: se ve igual (mismo tamaño efectivo)",
    opened.elements.every((e) => Math.abs(elementSize(e) - elementSize(DRAG.elements.find((d) => d.id === e.id)!, "lg")) < 1e-4));
  check("Pregunta de antes: conserva elementos y lugares, y es válida", opened.elements.length === DRAG.elements.length && opened.zones.length === DRAG.zones.length && imageDragProblem(opened, true) === null);
  const withSize = initialImageValue("image_drag", "foto", { aspect: 0.75, elements: [{ id: "a", kind: "icon", fileId: "f", size: 0.123456, ratio: 0.4, rotation: 15 }], zones: [] }).config as ImageDragConfig;
  check("Tamaño propio: se abre tal cual", JSON.stringify(withSize.elements[0]) === JSON.stringify({ id: "a", kind: "icon", fileId: "f", size: 0.123456, ratio: 0.4, rotation: 15 }), withSize.elements[0]);
  // Lo que exigía iconSize rehacía vacía una config sin él: borraba lo armado
  const value = { imageFileId: "foto", config: opened };
  check("Sin iconSize la forma encaja: no se rehace vacía", shapedImageValue("image_drag", value) === value);
  check("Otro tipo sí se rehace (con la misma foto y proporción)",
    (() => { const v = shapedImageValue("image_click", value); return v !== value && v.imageFileId === "foto" && v.config.aspect === opened.aspect && (v.config as ImageClickConfig).spots.length === 0; })());

  console.log("\n— Saneo y validación de los campos nuevos");
  const base = { aspect: 0.75, elements: [{ id: "a", kind: "icon", fileId: "f", size: 0.1, ratio: 1.5, rotation: 370 }], zones: [{ x: 0.5, y: 0.5, elementId: "a" }] };
  const clean = sanitizeImageConfig("image_drag", base) as ImageDragConfig;
  check("Saneo conserva size y ratio, y normaliza el giro", clean.elements[0].size === 0.1 && clean.elements[0].ratio === 1.5 && clean.elements[0].rotation === 10, clean);
  check("Sin iconSize ya es válida", imageDragProblem(clean, true) === null, imageDragProblem(clean, true));
  check("Tamaño de ícono fuera de rango", imageDragProblem({ ...clean, elements: [{ ...clean.elements[0], size: 0.9 }] }, true) === "Hay un elemento demasiado grande o demasiado chico");
  check("Letra fuera de rango", imageDragProblem({ ...clean, elements: [...clean.elements, { id: "t", kind: "text", text: "x", size: 0.2 }] }, true) === "Hay un elemento demasiado grande o demasiado chico");
  check("Proporción de ícono inválida", imageDragProblem({ ...clean, elements: [{ ...clean.elements[0], ratio: 50 }] }, true) === "Vuelve a subir un ícono");
  check("Pregunta vieja con iconSize sigue válida", imageDragProblem(DRAG, true) === null);
}

function canvasChecks() {
  console.log("\n— Guías, imán, alinear y repartir");
  const a: Bounds = { left: 0.1, right: 0.2, top: 0.1, bottom: 0.2 };
  // Centro en 0.51: lo más cercano es el centro de la foto (0.5); los bordes quedan lejos
  const b: Bounds = { left: 0.4, right: 0.62, top: 0.4, bottom: 0.5 };
  const s1 = snapMove(b, [a], { tx: 0.06, ty: 0.06 });
  check("Imán al centro de la foto", Math.abs(s1.dx - -0.01) < 1e-9 && s1.guides.some((g) => g.axis === "x" && g.at === 0.5), s1);
  const s2 = snapMove({ left: 0.105, right: 0.205, top: 0.7, bottom: 0.8 }, [a], { tx: 0.01, ty: 0.01 });
  check("Imán al borde izquierdo de otro lugar", Math.abs(s2.dx - -0.005) < 1e-9 && s2.guides.some((g) => g.axis === "x" && g.at === 0.1), s2);
  const s3 = snapMove({ left: 0.3, right: 0.35, top: 0.3, bottom: 0.35 }, [a], { tx: 0.001, ty: 0.001 });
  check("Lejos de todo: no se mueve ni hay guías", s3.dx === 0 && s3.dy === 0 && s3.guides.length === 0, s3);
  check("Cuadrícula de 10 %: pega el centro a la línea más cercana", JSON.stringify(snapToGrid({ x: 0.43, y: 0.58 }, 0.1)) === JSON.stringify({ x: 0.4, y: 0.6 }));
  const u = unionBounds([a, b]);
  check("Caja envolvente de varias", u.left === 0.1 && u.right === 0.62 && u.top === 0.1 && u.bottom === 0.5, u);
  // Estirar desde el centro (0.5, 0.5): el borde izquierdo (0.305) queda a 0.005 del derecho de `c` (0.3)
  const c: Bounds = { left: 0.25, right: 0.3, top: 0.8, bottom: 0.9 };
  const grow = { left: 0.305, right: 0.695, top: 0.45, bottom: 0.55 };
  const k1 = snapScale(grow, { x: 0.5, y: 0.5 }, [c], { tx: 0.01, ty: 0.01 });
  check(
    "Imán al estirar: el borde llega justo a la guía",
    !!k1 && Math.abs(k1.scale - 0.2 / 0.195) < 1e-6 && k1.guides.length === 1 && k1.guides[0].axis === "x" && k1.guides[0].at === 0.3,
    k1
  );
  check("Imán al estirar: lejos de todo, nada", snapScale(grow, { x: 0.5, y: 0.5 }, [c], { tx: 0.001, ty: 0.001 }) === null);
  const k2 = snapScale({ left: 0.4, right: 0.6, top: 0.405, bottom: 0.595 }, { x: 0.5, y: 0.5 }, [], { tx: 0.01, ty: 0.01, grid: 0.1 });
  check("Imán al estirar con cuadrícula: pega el borde a su línea", !!k2 && k2.guides[0].axis === "x" && k2.scale === 1, k2);
  // Borde derecho en 0.395 con cuadrícula de 10 %: crece hasta la línea 0.4 (el izquierdo, en 0.215, queda lejos de 0.2)
  const k3 = snapScale({ left: 0.215, right: 0.395, top: 0.45, bottom: 0.55 }, { x: 0.305, y: 0.5 }, [], { tx: 0.01, ty: 0.001, grid: 0.1 });
  check(
    "Imán al estirar con cuadrícula: el borde en 0.395 llega a 0.4",
    !!k3 && k3.guides[0].axis === "x" && k3.guides[0].at === 0.4 && Math.abs(k3.scale - 0.095 / 0.09) < 1e-9,
    k3
  );
  // Mismo hueco (0.004) en x y en y, pero el umbral de y es más holgado: gana y
  const k4 = snapScale({ left: 0.296, right: 0.704, top: 0.296, bottom: 0.704 }, { x: 0.5, y: 0.5 }, [{ left: 0.3, right: 0.3, top: 0.3, bottom: 0.3 }], { tx: 0.005, ty: 0.02 });
  check(
    "Imán al estirar: gana el eje más cercano en proporción a su umbral (y)",
    !!k4 && k4.guides.length === 1 && k4.guides[0].axis === "y" && k4.guides[0].at === 0.3 && Math.abs(k4.scale - 0.2 / 0.204) < 1e-9,
    k4
  );

  const boxes: Bounds[] = [
    { left: 0.1, right: 0.2, top: 0.1, bottom: 0.2 },
    { left: 0.4, right: 0.6, top: 0.3, bottom: 0.5 },
  ];
  const left = alignDeltas(boxes, "left");
  check("Alinear a la izquierda", left[0].dx === 0 && Math.abs(left[1].dx - -0.3) < 1e-9 && left[1].dy === 0, left);
  const mid = alignDeltas(boxes, "vcenter");
  check("Alinear al medio (vertical)", Math.abs(mid[0].dy - 0.15) < 1e-9 && Math.abs(mid[1].dy - -0.1) < 1e-9, mid);
  const three: Bounds[] = [
    { left: 0.0, right: 0.1, top: 0, bottom: 0.1 },
    { left: 0.15, right: 0.25, top: 0, bottom: 0.1 },
    { left: 0.8, right: 0.9, top: 0, bottom: 0.1 },
  ];
  const d = distributeDeltas(three, "x");
  check("Repartir: el del medio queda con el mismo espacio a los lados", Math.abs(d.deltas[1].dx - 0.25) < 1e-9 && d.deltas[0].dx === 0 && d.deltas[2].dx === 0 && Math.abs(d.gap - 0.3) < 1e-9, d);
  // Una caja ancha (0.2–0.9) abarca a la última en empezar (0.3–0.35): el tramo acaba en 0.9, no en 0.35
  const wide: Bounds[] = [
    { left: 0, right: 0.1, top: 0, bottom: 0.1 },
    { left: 0.2, right: 0.9, top: 0, bottom: 0.1 },
    { left: 0.3, right: 0.35, top: 0, bottom: 0.1 },
  ];
  const dw = distributeDeltas(wide, "x");
  check(
    "Repartir con una caja que abarca a otra: el tramo acaba en la que más lejos llega",
    Math.abs(dw.gap - 0.025) < 1e-9 && dw.deltas[0].dx === 0 && Math.abs(dw.deltas[1].dx - -0.075) < 1e-9 && Math.abs(0.35 + dw.deltas[2].dx - 0.9) < 1e-9,
    dw
  );
  const crowded: Bounds[] = [
    { left: 0, right: 0.5, top: 0, bottom: 0.1 },
    { left: 0.1, right: 0.6, top: 0, bottom: 0.1 },
    { left: 0.2, right: 0.7, top: 0, bottom: 0.1 },
  ];
  check("Repartir cajas que no caben: hueco negativo (el editor no reparte)", distributeDeltas(crowded, "x").gap < 0, distributeDeltas(crowded, "x"));

  console.log("\n— Zoom del lienzo y puntos de «señalar»");
  check("Zoom: + y − van al nivel siguiente y al anterior", zoomStep(1, 1) === 1.25 && zoomStep(1, -1) === 0.8 && zoomStep(1.5, 1) === 2);
  check("Zoom: entre dos niveles, + y − van al de al lado", zoomStep(1.4, 1) === 1.5 && zoomStep(1.4, -1) === 1.25);
  check("Zoom: topes del 50 y el 400 %", zoomStep(4, 1) === 4 && zoomStep(0.5, -1) === 0.5);
  check("Ctrl+rueda: una muesca es un nivel", wheelZoom(1, -100) === 1.25 && wheelZoom(1, 100) === 0.8 && wheelZoom(1, 3, 1) === 0.8);
  const pinch = wheelZoom(1, -10);
  check("Pellizco: pasos finos, poco a poco y con topes", pinch > 1 && pinch < 1.25 && wheelZoom(3.95, -10) === 4 && wheelZoom(0.51, 10) === 0.5, pinch);
  check("Cuadrícula: cada 10 %, y cada 5 % desde el 200 %", gridStepFor(1) === 0.1 && gridStepFor(1.5) === 0.1 && gridStepFor(2) === 0.05 && gridStepFor(4) === 0.05);
  const sp = snapSpot({ x: 0.302, y: 0.71 }, [{ x: 0.3, y: 0.2 }], { tx: 0.005, ty: 0.005 });
  check("Punto: se pega a la línea de otro punto (y la guía se ve)", sp.p.x === 0.3 && sp.p.y === 0.71 && sp.guides.some((g) => g.axis === "x" && g.at === 0.3), sp);
  const sc = snapSpot({ x: 0.497, y: 0.996 }, [], { tx: 0.005, ty: 0.005 });
  check("Punto: se pega al centro y al borde de la foto", sc.p.x === 0.5 && sc.p.y === 1, sc);
  const sg = snapSpot({ x: 0.648, y: 0.4 }, [], { tx: 0.005, ty: 0.005, grid: gridStepFor(2) });
  check("Punto: con cuadrícula al 200 %, se pega a la línea del 65 %", Math.abs(sg.p.x - 0.65) < 1e-9, sg);
  check("Punto: lejos de todo, no se mueve", JSON.stringify(snapSpot({ x: 0.33, y: 0.62 }, [{ x: 0.8, y: 0.1 }], { tx: 0.005, ty: 0.005 }).p) === JSON.stringify({ x: 0.33, y: 0.62 }));
}

function sanitizeChecks() {
  console.log("\n— Lo que llega del navegador");
  const long = "x".repeat(65);
  const raw = {
    aspect: 0.75,
    iconSize: "md",
    isCorrect: true, // basura: no se guarda
    elements: [
      { id: "ext", kind: "icon", fileId: "f-ext", text: "no va", extra: 1 },
      { id: "reu", kind: "text", text: "  Punto de reunión  ", fileId: "no-va" },
      { id: long, kind: "text", text: "id largo" },
    ],
    zones: [
      { x: 0.2, y: 0.3, elementId: "ext", correct: "reu" },
      { x: Infinity, y: NaN, elementId: 7 },
    ],
  };
  const clean = sanitizeImageConfig("image_drag", raw) as ImageDragConfig & Record<string, unknown>;
  check("Descarta los campos desconocidos", !("isCorrect" in clean) && !("extra" in clean.elements[0]) && !("correct" in clean.zones[0]));
  check("El ícono pierde su texto; la etiqueta, su archivo", !("text" in clean.elements[0]) && !("fileId" in clean.elements[1]), clean.elements);
  check("Recorta el texto de la etiqueta", clean.elements[1].text === "Punto de reunión");
  check("Ids de más de 64 caracteres fuera", !("id" in clean.elements[2]));
  check("Números no finitos y ids que no son texto fuera", JSON.stringify(clean.zones[1]) === "{}", clean.zones[1]);
  check("Lo limpio de una config buena queda igual", JSON.stringify(sanitizeImageConfig("image_drag", DRAG)) === JSON.stringify(DRAG));
  check("Señalar: solo proporción, precisión y puntos",
    JSON.stringify(sanitizeImageConfig("image_click", { ...CLICK, spots: [{ x: 0.1, y: 0.2, z: 3 }], precision: "xl", hint: "aquí" })) ===
      JSON.stringify({ aspect: 0.5, spots: [{ x: 0.1, y: 0.2 }] }));
  check("Basura total: queda vacía y la validación la rechaza",
    JSON.stringify(sanitizeImageConfig("image_click", "hola")) === '{"spots":[]}' && imageClickProblem(sanitizeImageConfig("image_click", "hola"), true) !== null);

  check("Leer arrastrar: completa", readImageDrag({ imageFileId: "foto", config: DRAG })?.image === "foto");
  check("Leer arrastrar: sin foto, null", readImageDrag({ imageFileId: null, config: DRAG }) === null);
  check("Leer arrastrar: config dañada, null", readImageDrag({ imageFileId: "foto", config: { ...DRAG, zones: "x" } }) === null);
  check("Leer señalar: completa y sin foto", readImageClick({ imageFileId: "foto", config: CLICK })?.config === CLICK && readImageClick({ imageFileId: null, config: CLICK }) === null);
}

function previewChecks() {
  console.log("\n— Vista previa del maestro (sin base)");
  const [choice] = questionsToPreview([
    { id: "q", type: "single_choice", promptMd: "¿?", points: 1, config: null, imageFileId: null, options: [{ textMd: "A", isCorrect: true }, { textMd: "B", isCorrect: false }] },
  ]);
  check("Las demás preguntas siguen igual", choice.answerText === "A" && choice.options.length === 2 && !choice.solution);
  const incomplete = imagePreview({ id: "q", type: "image_drag", promptMd: "", points: 1, imageFileId: null, config: DRAG });
  check("Imagen incompleta: sin tablero ni solución, y lo dice", incomplete.image === null && incomplete.imageDrag === null && !incomplete.solution && !!incomplete.answerText);
  const draft = imagePreview({ id: "borrador", type: "image_drag", promptMd: "", points: 1, imageFileId: "foto", config: DRAG });
  check("La pregunta del editor (sin guardar) también se previsualiza", draft.imageDrag?.items.length === 5 && draft.solution?.kind === "drag");
  const solo = dragReviewBoard("foto", DRAG);
  check("Tablero de solución: cada lugar con su elemento, sin respuesta del alumno",
    solo.zones.length === 4 && solo.zones.every((z) => z.placed === null && z.correct) && solo.zones[3].expected.text === "Punto de reunión");
  const withAnswer = dragReviewBoard("foto", DRAG, ["reg", "ext"]);
  check("Tablero con respuesta: lo puesto y si acertó",
    withAnswer.zones[0].placed?.text === "Regadera" && !withAnswer.zones[0].correct && withAnswer.zones[1].correct && withAnswer.zones[2].placed === null);
  const clickSolo = clickReviewBoard("foto", CLICK);
  check("Tablero de señalar sin marcas: todos los puntos, ninguna marca",
    clickSolo.spots.length === 2 && clickSolo.spots.every((s) => s.hit) && clickSolo.marks.length === 0 && clickSolo.radius === PRECISION_RADIUS.md);
}

// ─── Recorrido contra la base ────────────────────────────────────────────────

const P = "zimg";
const email = (key: string) => `${P}-${key}@test.local`;
// Ids de elemento y coordenadas de puntos inconfundibles: si aparecen en lo que
// recibe el alumno, es que se filtró la solución
const EL = { ext: "zimgElExtintor", sal: "zimgElSalida", reu: "zimgElReunion", reg: "zimgElRegadera" };
const SPOTS = [
  { x: 0.237, y: 0.614 },
  { x: 0.781, y: 0.352 },
];

function makeUser(key: string, role: "teacher" | "student" | "admin", createdBy: string | null): string {
  const id = `${P}-${key}-${Date.now().toString(36)}`;
  db.insert(users).values({ id, email: email(key), passwordHash: "x", fullName: `${P} ${key}`, role, createdBy }).run();
  return id;
}

async function png(color: { r: number; g: number; b: number }, width = 40, height = 30): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background: { ...color, alpha: 1 } } }).png().toBuffer();
}

async function upload(bytes: Buffer, name: string, userId: string, kind: "editor_image" | "attachment" = "editor_image") {
  const { id } = await saveStream({
    stream: Readable.from(bytes),
    originalName: `${P}-${name}.png`,
    mimeType: "image/png",
    kind,
    uploadedBy: userId,
  });
  return id;
}

/** Borra todo lo zimg: cursos (en cascada, preguntas e intentos), avisos, archivos y cuentas. */
async function cleanupDb() {
  const userIds = db.select({ id: users.id }).from(users).where(like(users.email, `${P}-%@test.local`)).all().map((u) => u.id);
  const courseIds = db.select({ id: coursesTable.id }).from(coursesTable).where(like(coursesTable.title, `${P} %`)).all().map((c) => c.id);
  cleanupSmokeNotifications(courseIds);
  // Sin deleteCourse: encolaría el retiro de archivos para el worker; aquí se borran a mano
  if (courseIds.length) db.delete(coursesTable).where(inArray(coursesTable.id, courseIds)).run();
  if (userIds.length) {
    db.delete(notifications).where(inArray(notifications.userId, userIds)).run();
    db.delete(auditLog).where(inArray(auditLog.userId, userIds)).run();
  }
  // Los archivos van después de las preguntas (las apuntan) y antes de las cuentas (quien los subió)
  const fileIds = db
    .select({ id: files.id })
    .from(files)
    .where(or(like(files.originalName, `${P}-%`), userIds.length ? inArray(files.uploadedBy, userIds) : undefined))
    .all()
    .map((f) => f.id);
  for (const id of fileIds) await deleteFile(id);
  if (userIds.length) db.delete(users).where(inArray(users.id, userIds)).run();
}

async function endToEnd() {
  console.log("\n— Recorrido contra la base");
  await cleanupDb(); // restos de una corrida que se cortó
  try {
    const teacher = makeUser("maestro", "teacher", null);
    const other = makeUser("otro", "teacher", null);
    const student = makeUser("alumno", "student", teacher);

    const photo = await upload(await png({ r: 90, g: 160, b: 90 }, 400, 300), "foto", teacher);
    const iconExt = await upload(await png({ r: 220, g: 40, b: 40 }), "extintor", teacher);
    const iconSal = await upload(await png({ r: 40, g: 160, b: 60 }), "salida", teacher);
    const otherPhoto = await upload(await png({ r: 10, g: 10, b: 10 }), "ajena", other);
    const notEditor = await upload(await png({ r: 10, g: 10, b: 200 }), "adjunto", teacher, "attachment");

    const drag: ImageDragConfig = {
      aspect: 0.75,
      iconSize: "md",
      elements: [
        { id: EL.ext, kind: "icon", fileId: iconExt },
        { id: EL.sal, kind: "icon", fileId: iconSal },
        { id: EL.reu, kind: "text", text: "Punto de reunión" },
        { id: EL.reg, kind: "text", text: "Regadera" }, // distractor
      ],
      zones: [
        { x: 0.2, y: 0.3, elementId: EL.ext },
        { x: 0.6, y: 0.3, elementId: EL.ext },
        { x: 0.9, y: 0.8, elementId: EL.sal },
        { x: 0.3, y: 0.8, elementId: EL.reu },
      ],
    };
    const click: ImageClickConfig = { aspect: 0.5, precision: "md", spots: SPOTS };

    const u = { id: teacher, role: "teacher" };
    check("Archivos: los suyos valen", examsSvc.imageQuestionFilesProblem(u, photo, drag) === null);
    check("Archivos: una foto de otro maestro no", examsSvc.imageQuestionFilesProblem(u, otherPhoto, drag) === "Una de las imágenes no es válida; vuelve a subirla.");
    check("Archivos: un ícono de otro maestro no", examsSvc.imageQuestionFilesProblem(u, photo, { ...drag, elements: [{ id: "x", kind: "icon", fileId: otherPhoto }] }) !== null);
    check("Archivos: un archivo que no es imagen del editor no", examsSvc.imageQuestionFilesProblem(u, notEditor, drag) !== null);
    check("Archivos: un id inventado no", examsSvc.imageQuestionFilesProblem(u, "no-existe", drag) !== null);
    check("Archivos: el admin puede usar cualquiera", examsSvc.imageQuestionFilesProblem({ id: "admin", role: "admin" }, otherPhoto, drag) === null);

    const course = courses.createCourse({ ownerId: teacher, title: `${P} Preguntas sobre imagen` });
    const exam = tree.createItem({ courseId: course.id, parentId: null, kind: "exam", title: `${P} Examen` });
    let noPhoto = "";
    try {
      examsSvc.createQuestion(exam.id, { type: "image_drag", promptMd: "Sin foto", points: 1, config: drag, imageFileId: null });
    } catch (e) {
      noPhoto = (e as Error).message;
    }
    check("Guardar sin foto se niega", noPhoto === "Sube la foto de la pregunta", noPhoto);
    const qDrag = examsSvc.createQuestion(exam.id, { type: "image_drag", promptMd: "Coloca cada señal", points: 4, config: drag, imageFileId: photo });
    const qClick = examsSvc.createQuestion(exam.id, { type: "image_click", promptMd: "Señala los extintores", points: 2, config: click, imageFileId: photo });
    check("Al editar, los archivos que la pregunta ya tenía siguen valiendo", examsSvc.imageQuestionFilesProblem({ id: other, role: "teacher" }, photo, drag, qDrag) === null);
    check("…sin la pregunta, no", examsSvc.imageQuestionFilesProblem({ id: other, role: "teacher" }, photo, drag) !== null);

    // «Ver como alumno» del maestro: las de imagen entran, con fichas locales y la solución
    const preview = questionsToPreview(examsSvc.listQuestions(exam.id));
    const pd = preview.find((q) => q.id === qDrag);
    const pc = preview.find((q) => q.id === qClick);
    check("Vista previa: incluye las dos preguntas sobre imagen", preview.length === 2 && !!pd && !!pc);
    check("Vista previa de arrastrar: foto y proporción", pd?.image === photo && pd?.imageDrag?.aspect === 0.75);
    check("Vista previa de arrastrar: cada ficha con su tamaño (sin tamaño común)",
      !!pd?.imageDrag && !("iconSize" in pd.imageDrag) && pd.imageDrag.items.every((it) => typeof it.size === "number"), pd?.imageDrag?.items);
    check("Vista previa de arrastrar: una ficha por copia y un lugar por lugar",
      pd?.imageDrag?.items.length === dragCopies(drag).length && pd?.imageDrag?.zones.length === drag.zones.length, pd?.imageDrag);
    const previewTokens = [...(pd?.imageDrag?.zones ?? []), ...(pd?.imageDrag?.items ?? [])].map((t) => t.token);
    check("Vista previa de arrastrar: fichas únicas", previewTokens.length === 9 && new Set(previewTokens).size === 9, previewTokens);
    check("Vista previa de arrastrar: el extintor sale dos veces en el banco",
      pd?.imageDrag?.items.filter((it) => it.fileId === iconExt).length === 2);
    const sd = pd?.solution?.kind === "drag" ? pd.solution : null;
    check("Vista previa de arrastrar: la solución pone cada elemento en su lugar",
      !!sd && sd.zones.length === drag.zones.length &&
        sd.zones.every((z, i) => {
          const want = drag.elements.find((e) => e.id === drag.zones[i].elementId)!;
          return z.x === drag.zones[i].x && z.y === drag.zones[i].y && z.expected.kind === want.kind &&
            z.expected.fileId === want.fileId && z.expected.text === want.text;
        }) &&
        [...sd.iconFiles].sort().join() === [iconExt, iconSal].sort().join(), sd);
    check("Vista previa de arrastrar: la solución trae cada elemento con tamaño, proporción y giro (sin tamaño común)",
      !!sd && !("iconSize" in sd) && sd.zones.every((z) => [z.expected.size, z.expected.ratio, z.expected.rotation].every((n) => typeof n === "number")), sd);
    const sc = pc?.solution?.kind === "click" ? pc.solution : null;
    check("Vista previa de señalar: cuántas marcas y la solución con sus puntos y su radio",
      pc?.imageClick?.marks === 2 && !!sc && sc.radius === PRECISION_RADIUS.md && sc.marks.length === 0 &&
        JSON.stringify(sc.spots.map(({ x, y }) => ({ x, y }))) === JSON.stringify(SPOTS), sc);

    courses.publishCourse(course.id);
    courses.enrollStudents(course.id, [student], teacher);

    const attempt = examsSvc.startAttempt({ courseId: course.id, studentId: student, examItemId: exam.id });
    const runner = buildRunnerQuestions(attempt);
    const json = JSON.stringify(runner);
    const rd = runner.find((q) => q.id === qDrag)!;
    const rc = runner.find((q) => q.id === qClick)!;
    check("El alumno no recibe elementId", !json.includes("elementId"));
    check("…ni los ids de los elementos", Object.values(EL).every((id) => !json.includes(id)), Object.values(EL).filter((id) => json.includes(id)));
    check("…ni los puntos correctos", !json.includes("spots") && SPOTS.every((s) => !json.includes(String(s.x)) && !json.includes(String(s.y))));
    check("…ni la configuración", !json.includes("config") && !json.includes("precision"));
    check("Arrastrar: 5 fichas en el banco y 4 lugares", rd.imageDrag?.items.length === 5 && rd.imageDrag?.zones.length === 4, { items: rd.imageDrag?.items.length, zones: rd.imageDrag?.zones.length });
    check("Arrastrar: lleva la foto y la proporción, sin tamaño común", rd.image === photo && rd.imageDrag?.aspect === 0.75 && !("iconSize" in rd.imageDrag!));
    check("Arrastrar: cada ficha trae tamaño, proporción y giro",
      rd.imageDrag!.items.every((it) => [it.size, it.ratio, it.rotation].every((n) => typeof n === "number" && Number.isFinite(n))), rd.imageDrag?.items);
    // Pregunta de antes (iconSize "md", sin tamaño por elemento): íconos al mediano, letra por defecto
    check("Arrastrar: las fichas de una pregunta vieja salen de iconSize",
      rd.imageDrag!.items.every((it) => it.size === (it.kind === "icon" ? elementSize({ kind: "icon" }, "md") : DEFAULT_TEXT_SIZE) && it.ratio === 1 && it.rotation === 0), rd.imageDrag?.items);
    check("Arrastrar: fichas opacas y distintas", new Set([...rd.imageDrag!.zones, ...rd.imageDrag!.items].map((t) => t.token)).size === 9 &&
      [...rd.imageDrag!.zones, ...rd.imageDrag!.items].every((t) => /^[0-9a-f]{16}$/.test(t.token)));
    check("Arrastrar: los lugares no traen tamaño ni elemento", rd.imageDrag!.zones.every((z) => Object.keys(z).sort().join() === "token,x,y"));
    // Lista blanca: una clave nueva en las fichas debe pensarse (¿delata algo?) y agregarse aquí
    check("Arrastrar: cada ficha trae solo su cara (token, tipo, archivo o texto, tamaño, proporción y giro)",
      rd.imageDrag!.items.every((it) => Object.keys(it).sort().join() ===
        (it.kind === "icon" ? "fileId,kind,ratio,rotation,size,token" : "kind,ratio,rotation,size,text,token")),
      rd.imageDrag!.items.map((it) => Object.keys(it).sort().join()));
    check("Señalar: solo la foto y cuántas marcas", rc.image === photo && JSON.stringify(rc.imageClick) === JSON.stringify({ aspect: 0.5, marks: 2 }));
    check("Las demás claves nuevas quedan en null", rd.imageClick === null && rc.imageDrag === null && rd.matching === null && rd.ordering === null);

    // Respuesta correcta calculada con las mismas fichas que el servidor, con
    // los dos extintores cruzados (copia 1 en el primer lugar, copia 0 en el
    // segundo): da igual qué copia vaya en cuál
    const [z0, z1, z2, z3] = drag.zones.map((z) => examsSvc.imageZoneToken(attempt.id, qDrag, z));
    const item = (elementId: string, copy: number) => examsSvc.imageItemToken(attempt.id, qDrag, elementId, copy);
    const ext0 = item(EL.ext, 0);
    const answer: Record<string, string> = { [z0]: item(EL.ext, 1), [z1]: ext0, [z2]: item(EL.sal, 0), [z3]: item(EL.reu, 0) };
    check("Las fichas de la respuesta están en lo que recibe el alumno",
      Object.entries(answer).every(([z, it]) => rd.imageDrag!.zones.some((x) => x.token === z) && rd.imageDrag!.items.some((x) => x.token === it)));

    // La misma ficha en dos lugares solo cuenta una vez; una ficha inventada no cuenta
    const twice = examsSvc.imageDragPlacement(drag, JSON.stringify({ [z0]: ext0, [z1]: ext0, [z2]: answer[z2], [z3]: answer[z3] }), attempt.id, qDrag);
    check("La misma ficha en dos lugares cuenta una vez", imageDragScore(drag, twice) === 0.75, twice);
    const forged = examsSvc.imageDragPlacement(drag, JSON.stringify({ [z0]: "0123456789abcdef", [z1]: EL.ext }), attempt.id, qDrag);
    check("Fichas inventadas o ids de elemento no cuentan", forged.every((p) => p === undefined), forged);

    // La ficha de un lugar va por sus coordenadas: si el maestro lo mueve, ese
    // lugar queda vacío y los demás no cambian
    const moved: ImageDragConfig = { ...drag, zones: drag.zones.map((z, i) => (i === 2 ? { ...z, x: 0.85 } : z)) };
    const afterMove = examsSvc.imageDragPlacement(moved, JSON.stringify(answer), attempt.id, qDrag);
    check("Mover un lugar lo deja vacío; los demás siguen acreditados",
      afterMove[2] === undefined && imageDragScore(moved, afterMove) === 0.75, afterMove);

    const r = PRECISION_RADIUS.md;
    const marks = [
      { x: SPOTS[0].x + r * 0.5, y: SPOTS[0].y }, // dentro del radio
      { x: SPOTS[1].x + r * 3, y: SPOTS[1].y }, // fuera
    ];
    examsSvc.saveAnswer({ studentId: student, attemptId: attempt.id, questionId: qDrag, answerText: JSON.stringify(answer) });
    examsSvc.saveAnswer({ studentId: student, attemptId: attempt.id, questionId: qClick, answerText: JSON.stringify(marks) });
    const graded = examsSvc.submitAttempt({ courseId: course.id, studentId: student, attemptId: attempt.id });
    check("Calificado: 4 de 4 en arrastrar + 1 de 2 en señalar = 5", graded.status === "graded" && graded.finalScore === 5, { status: graded.status, score: graded.finalScore });

    const review = buildReview(graded);
    const vd = review.find((e) => e.questionId === qDrag)!;
    const vc = review.find((e) => e.questionId === qClick)!;
    check("Revisión de arrastrar: texto", vd.yourAnswer === "4 de 4 lugares correctos" && vd.correctAnswer === "Mira la imagen con la solución" && vd.result === "correct", vd);
    const bd = vd.board?.kind === "drag" ? vd.board : null;
    check("Revisión de arrastrar: tablero con cada lugar bien y la solución",
      !!bd && bd.image === photo && bd.zones.length === 4 && bd.zones.every((z) => z.correct && z.placed !== null) &&
      bd.zones[0].expected.fileId === iconExt && bd.zones[3].expected.text === "Punto de reunión", bd);
    check("Revisión de arrastrar: lleva los archivos de todos los íconos (para numerarlos como el alumno)",
      !!bd && [...bd.iconFiles].sort().join() === [iconExt, iconSal].sort().join(), bd?.iconFiles);
    check("Revisión de señalar: texto", vc.yourAnswer === "1 de 2 puntos señalados" && vc.result === "partial" && vc.earnedPoints === 1, vc);
    const bc = vc.board?.kind === "click" ? vc.board : null;
    check("Revisión de señalar: puntos acertados y marcas",
      !!bc && bc.radius === r && JSON.stringify(bc.spots.map((s) => s.hit)) === "[true,false]" && bc.marks.length === 2, bc);

    // Una respuesta sin ninguna colocación válida se lee como «Sin respuesta», igual que en señalar
    db.update(attemptAnswers)
      .set({ answerText: JSON.stringify({ [z0]: "0123456789abcdef" }) })
      .where(and(eq(attemptAnswers.attemptId, attempt.id), eq(attemptAnswers.questionId, qDrag)))
      .run();
    const empty = buildReview(graded).find((e) => e.questionId === qDrag)!;
    check("Revisión de arrastrar sin colocaciones válidas: «Sin respuesta»",
      empty.yourAnswer === "Sin respuesta" && empty.board?.kind === "drag" && empty.board.zones.every((z) => z.placed === null), empty);

    // ─── El maestro quita el primer lugar con un intento ya contestado ────────
    // Los lugares que quedan siguen acreditados; con fichas por posición se
    // corrían un lugar y la respuesta, toda bien puesta, valía 0.
    // En su propio curso: con la secuencia obligatoria, un segundo examen aquí
    // quedaría bloqueado
    const editCourse = courses.createCourse({ ownerId: teacher, title: `${P} Editar con intento` });
    const editExam = tree.createItem({ courseId: editCourse.id, parentId: null, kind: "exam", title: `${P} Examen editado` });
    const qEdit = examsSvc.createQuestion(editExam.id, { type: "image_drag", promptMd: "Coloca cada señal", points: 3, config: drag, imageFileId: photo });
    courses.publishCourse(editCourse.id);
    courses.enrollStudents(editCourse.id, [student], teacher);
    const open = examsSvc.startAttempt({ courseId: editCourse.id, studentId: student, examItemId: editExam.id });
    const zoneOf = (z: { x: number; y: number }) => examsSvc.imageZoneToken(open.id, qEdit, z);
    const itemOf = (elementId: string, copy: number) => examsSvc.imageItemToken(open.id, qEdit, elementId, copy);
    const allRight = {
      [zoneOf(drag.zones[0])]: itemOf(EL.ext, 1),
      [zoneOf(drag.zones[1])]: itemOf(EL.ext, 0),
      [zoneOf(drag.zones[2])]: itemOf(EL.sal, 0),
      [zoneOf(drag.zones[3])]: itemOf(EL.reu, 0),
    };
    examsSvc.saveAnswer({ studentId: student, attemptId: open.id, questionId: qEdit, answerText: JSON.stringify(allRight) });
    const trimmed: ImageDragConfig = { ...drag, zones: drag.zones.slice(1) };
    examsSvc.updateQuestion(qEdit, { type: "image_drag", promptMd: "Coloca cada señal", points: 3, config: trimmed, imageFileId: photo });
    const afterEdit = examsSvc.submitAttempt({ courseId: editCourse.id, studentId: student, attemptId: open.id });
    check("Quitar el primer lugar con el intento contestado: los otros tres siguen acreditados (3 de 3)",
      afterEdit.status === "graded" && afterEdit.finalScore === 3, { status: afterEdit.status, score: afterEdit.finalScore });
    const editReview = buildReview(afterEdit).find((e) => e.questionId === qEdit);
    check("…y la revisión lo lee igual", editReview?.yourAnswer === "3 de 3 lugares correctos", editReview);
    check("…y el maestro al calificar ve lo mismo que el alumno",
      imageAnswerSummary(examsSvc.listQuestions(editExam.id)[0], JSON.stringify(allRight), open.id) === "3 de 3 lugares correctos");
    check("Resumen: una respuesta «{}» o «[]» se lee «Sin respuesta», no como contestada",
      imageAnswerSummary({ id: qEdit, type: "image_drag", imageFileId: photo, config: trimmed }, "{}", open.id) === "Sin respuesta" &&
        imageAnswerSummary({ id: qEdit, type: "image_drag", imageFileId: photo, config: trimmed }, "[]", open.id) === "Sin respuesta");

    const copyId = examsSvc.duplicateQuestion(exam.id, qDrag);
    const copied = examsSvc.listQuestions(exam.id).find((q) => q.id === copyId);
    check("Duplicar dentro del examen comparte la foto", copied?.imageFileId === photo && JSON.stringify(copied?.config) === JSON.stringify(drag));

    // ─── Copiar la lección/examen: la foto y los íconos se comparten ──────────
    const examCopy = await tree.duplicateItem({
      sourceItemId: exam.id,
      targetCourseId: course.id,
      parentId: null,
      index: 99,
      uploadedBy: teacher,
    });
    const copiedQs = examsSvc.listQuestions(examCopy.item.id);
    const copiedDrag = copiedQs.find((q) => q.type === "image_drag" && q.promptMd === "Coloca cada señal");
    const copiedClick = copiedQs.find((q) => q.type === "image_click");
    check("Copiar el examen: la copia tiene las 3 preguntas (arrastrar, señalar y su copia)", copiedQs.length === 3, copiedQs.length);
    check("Copiar el examen: arrastrar conserva la foto y la config", copiedDrag?.imageFileId === photo && JSON.stringify(copiedDrag?.config) === JSON.stringify(drag), copiedDrag);
    check("Copiar el examen: señalar conserva la foto y la config", copiedClick?.imageFileId === photo && JSON.stringify(copiedClick?.config) === JSON.stringify(click), copiedClick);
    check("Copiar el examen: el alumno puede ver la copia de arrastrar (readImageDrag no nulo)", !!copiedDrag && readImageDrag(copiedDrag) !== null);
    check("Copiar el examen: el alumno puede ver la copia de señalar (readImageClick no nulo)", !!copiedClick && readImageClick(copiedClick) !== null);
    check("Copiar el examen: no faltó ningún archivo", examCopy.missingFiles === 0, examCopy.missingFiles);

    // La copia a OTRO curso del mismo maestro también comparte la foto
    const course2 = courses.createCourse({ ownerId: teacher, title: `${P} Curso destino` });
    const examCopy2 = await tree.duplicateItem({
      sourceItemId: exam.id,
      targetCourseId: course2.id,
      parentId: null,
      index: 0,
      uploadedBy: teacher,
    });
    const copiedQs2 = examsSvc.listQuestions(examCopy2.item.id);
    check("Copiar a otro curso también comparte la foto", copiedQs2.length === 3 && copiedQs2.every((q) => q.imageFileId === photo), copiedQs2.map((q) => q.imageFileId));

    // ─── CSV: las preguntas sobre imagen no caben — se omiten y se cuentan ────
    check("countImageQuestions cuenta las 3 preguntas sobre imagen", countImageQuestions(exam.id) === 3, countImageQuestions(exam.id));
    const csvExport = exportExamCsv(exam.id);
    check("exportExamCsv las omite (CSV sin filas)", parseCsv(csvExport, { maxRows: 10 }).rows.length === 0, csvExport);

    // ─── Reemplazar por CSV: borra solo lo que el CSV puede representar ───────
    examsSvc.createQuestion(exam.id, {
      type: "single_choice",
      promptMd: `${P} Pregunta de opción`,
      points: 1,
      options: [
        { textMd: "A", isCorrect: true },
        { textMd: "B", isCorrect: false },
      ],
    });
    const csvWithChoice = parseCsv(exportExamCsv(exam.id), { maxRows: 10 });
    check(
      "exportExamCsv con una pregunta exportable: exactamente 1 fila opcion_unica",
      csvWithChoice.rows.length === 1 && csvWithChoice.rows[0].cells[0] === "opcion_unica",
      csvWithChoice.rows
    );
    check("Antes de reemplazar: 4 preguntas (3 de imagen + 1 de opción)", examsSvc.listQuestions(exam.id).length === 4);
    const replaced = importQuestionInputs({
      actorId: teacher,
      examItemId: exam.id,
      inputs: [
        {
          type: "single_choice",
          promptMd: `${P} Pregunta nueva`,
          points: 2,
          options: [
            { textMd: "X", isCorrect: true },
            { textMd: "Y", isCorrect: false },
          ],
        },
      ],
      mode: "replace",
      source: "csv",
    });
    check("Reemplazar conserva las 3 preguntas sobre imagen (kept)", replaced.kept === 3, replaced);
    check("Reemplazar importa la nueva sin saltarse ninguna", replaced.imported === 1 && replaced.skipped === 0, replaced);
    const afterReplace = examsSvc.listQuestions(exam.id);
    check("Después de reemplazar: 4 preguntas (3 de imagen + la nueva)", afterReplace.length === 4, afterReplace.length);
    check("La pregunta de opción vieja ya no está", !afterReplace.some((q) => q.promptMd === `${P} Pregunta de opción`));
    check(
      "Las preguntas sobre imagen siguen con su foto tras reemplazar",
      afterReplace.filter((q) => isImageQuestionType(q.type)).every((q) => q.imageFileId === photo)
    );

    // ─── Reemplazar conserva el ORDEN: cada imagen vuelve a su índice, las
    // nuevas llenan los huecos en su orden y las que sobran van al final ─────
    const orderExam = tree.createItem({ courseId: course.id, parentId: null, kind: "exam", title: `${P} Orden` });
    const choiceInput = (n: string) => ({
      type: "single_choice" as const,
      promptMd: `${P} ${n}`,
      points: 1,
      options: [
        { textMd: "A", isCorrect: true },
        { textMd: "B", isCorrect: false },
      ],
    });
    const p1 = examsSvc.createQuestion(orderExam.id, choiceInput("P1"));
    const imgId = examsSvc.createQuestion(orderExam.id, {
      type: "image_click",
      promptMd: `${P} IMG`,
      points: 1,
      config: click,
      imageFileId: photo,
    });
    const p2 = examsSvc.createQuestion(orderExam.id, choiceInput("P2"));
    const p3 = examsSvc.createQuestion(orderExam.id, choiceInput("P3"));
    check(
      "Orden inicial intercalado: P1, IMG, P2, P3",
      examsSvc.listQuestions(orderExam.id).map((q) => q.id).join() === [p1, imgId, p2, p3].join()
    );

    // Menos nuevas (2) que huecos (3): las que sobran se compactan y la
    // imagen vuelve a su índice original (1)
    const r1 = importQuestionInputs({
      actorId: teacher,
      examItemId: orderExam.id,
      inputs: [choiceInput("N1"), choiceInput("N2")],
      mode: "replace",
      source: "csv",
    });
    check("Menos nuevas que huecos: kept = 1 (la imagen)", r1.kept === 1, r1);
    const afterR1 = examsSvc.listQuestions(orderExam.id);
    check(
      "Orden tras reemplazar con menos: [nueva, IMG, nueva] y la imagen es la misma pregunta de antes",
      afterR1.length === 3 && afterR1[1].id === imgId && afterR1.map((q) => q.type).join() === "single_choice,image_click,single_choice",
      afterR1.map((q) => ({ id: q.id, type: q.type }))
    );
    check(
      "Orden tras reemplazar con menos, por promptMd: N1 antes que N2",
      afterR1.map((q) => q.promptMd).join() === [`${P} N1`, `${P} IMG`, `${P} N2`].join(),
      afterR1.map((q) => q.promptMd)
    );
    check("La imagen conserva su foto y config tras reordenar", afterR1[1].imageFileId === photo && readImageClick(afterR1[1]) !== null);

    // Más nuevas (4) que huecos (2): las que sobran van al final, la imagen
    // sigue en su índice
    const r2 = importQuestionInputs({
      actorId: teacher,
      examItemId: orderExam.id,
      inputs: [choiceInput("M1"), choiceInput("M2"), choiceInput("M3"), choiceInput("M4")],
      mode: "replace",
      source: "csv",
    });
    check("Reemplazar de nuevo: kept sigue siendo 1 (la imagen)", r2.kept === 1, r2);
    const afterR2 = examsSvc.listQuestions(orderExam.id);
    check(
      "Orden tras reemplazar con más: la imagen sigue en el índice 1 y las que sobran van al final",
      afterR2.length === 5 &&
        afterR2[1].id === imgId &&
        afterR2.map((q) => q.type).join() === "single_choice,image_click,single_choice,single_choice,single_choice",
      afterR2.map((q) => q.type)
    );
    check(
      "Orden tras reemplazar con más, por promptMd: M1..M4 en orden",
      afterR2.map((q) => q.promptMd).join() === [`${P} M1`, `${P} IMG`, `${P} M2`, `${P} M3`, `${P} M4`].join(),
      afterR2.map((q) => q.promptMd)
    );
  } finally {
    await cleanupDb();
    const left =
      db.select({ id: users.id }).from(users).where(like(users.email, `${P}-%@test.local`)).all().length +
      db.select({ id: files.id }).from(files).where(like(files.originalName, `${P}-%`)).all().length +
      db.select({ id: coursesTable.id }).from(coursesTable).where(like(coursesTable.title, `${P} %`)).all().length;
    check("Limpieza: no quedan cuentas, archivos ni cursos zimg", left === 0, left);
  }
}

async function main() {
  mathChecks();
  validationChecks();
  layoutChecks();
  canvasChecks();
  sanitizeChecks();
  previewChecks();
  await endToEnd();
  console.log(failures === 0 ? "\nTodo bien" : `\n${failures} fallo(s)`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
