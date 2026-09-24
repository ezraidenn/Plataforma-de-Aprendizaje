/**
 * Preguntas sobre imagen (arrastrar y señalar): matemática pura, validación y,
 * en tareas siguientes, el recorrido completo contra la base. Datos con prefijo
 * «zimg», borrados al final.
 *
 * Uso: pnpm smoke:image
 */
import {
  PRECISION_RADIUS,
  SNAP_RADIUS,
  dragCopies,
  imageClickHits,
  imageClickProblem,
  imageClickScore,
  imageDragProblem,
  imageDragScore,
  nearestZone,
  parseClickAnswer,
  parseDragAnswer,
  relDistance,
  type ImageClickConfig,
  type ImageDragConfig,
} from "../src/lib/image-questions";

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
  check("Copias intercambiables: da igual cuál extintor", imageDragScore(DRAG, ["ext", "ext", "sal", "reu"]) === 1);
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
  check("Encaje: la sombra más cercana dentro del radio", nearestZone(zones, { x: 0.22, y: 0.31 }, DRAG.aspect, () => true) === 0);
  check("Encaje: lejos de todas, ninguna", nearestZone(zones, { x: 0.45, y: 0.55 }, DRAG.aspect, () => true) === null);
  check("Encaje: salta las ocupadas", nearestZone(zones, { x: 0.22, y: 0.31 }, DRAG.aspect, (i) => i !== 0) === null);
  check("Radio de encaje razonable", SNAP_RADIUS > 0 && SNAP_RADIUS < 0.2);

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
  check("Demasiados elementos", imageDragProblem({ ...DRAG, elements: Array.from({ length: 21 }, (_, i) => ({ id: `e${i}`, kind: "text" as const, text: "t" })) }, true) !== null);
  check("Config ilegible", imageDragProblem(null, true) !== null);
  check("Señalar válido", imageClickProblem(CLICK, true) === null, imageClickProblem(CLICK, true));
  check("Señalar sin puntos", imageClickProblem({ ...CLICK, spots: [] }, true) === "Marca al menos un punto en la foto");
  check("Señalar con 11 puntos", imageClickProblem({ ...CLICK, spots: Array.from({ length: 11 }, () => ({ x: 0.5, y: 0.5 })) }, true) === "Usa como máximo diez puntos");
  check("Proporción inválida", imageClickProblem({ ...CLICK, aspect: 0 }, true) !== null);
}

async function main() {
  mathChecks();
  validationChecks();
  console.log(failures === 0 ? "\nTodo bien" : `\n${failures} fallo(s)`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
