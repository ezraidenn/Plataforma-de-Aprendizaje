import "server-only";
import { createHmac } from "node:crypto";
import { dragCopies, parseMapAnswer, zoneKey, type ImageDragConfig, type ImageZone } from "@/lib/image-questions";
import type { CategorizeConfig } from "@/lib/categorize";
import { clozeBankWords, clozeOptions, parseCloze, type ClozeConfig } from "@/lib/cloze";

/**
 * Fichas opacas por intento y lectura de las respuestas que las usan. Lo que
 * recibe el alumno (lesson-data), la calificación (exams) y la revisión
 * (exam-review) piden aquí las fichas y leen aquí las respuestas: así las tres
 * lo hacen igual.
 */

/**
 * HMAC de las partes unidas con «|», recortado a 16 hexadecimales. Es
 * determinista por (tipo, intento, pregunta, …): se recalcula al calificar sin
 * guardar nada extra, y el cliente no puede deducir de él lo que oculta.
 */
function opaqueToken(...parts: (string | number)[]): string {
  const secret = process.env.APP_SECRET ?? "dev-secret";
  return createHmac("sha256", secret).update(parts.join("|")).digest("hex").slice(0, 16);
}

/**
 * Token opaco por intento para las derechas del matching: el cliente solo ve
 * tokens (no el índice original), así el DOM no revela la solución.
 */
export function matchingToken(attemptId: string, questionId: string, originalIndex: number): string {
  return opaqueToken("match", attemptId, questionId, originalIndex);
}

/** Token opaco de cada paso de «ordenar»: como el de relacionar, con otro prefijo. */
export function orderingToken(attemptId: string, questionId: string, originalIndex: number): string {
  return opaqueToken("order", attemptId, questionId, originalIndex);
}

/**
 * Ficha opaca de un lugar de «arrastrar a la imagen». Va por la clave estable
 * del lugar (`zoneKey`: su `key` o, en una pregunta de antes sin ella, sus
 * coordenadas tal como están guardadas; no hay dos iguales, lo revisa la
 * validación), no por su posición en `config.zones`. Así, con un intento en
 * curso o ya enviado, el maestro puede mover el lugar, o recortar o girar la
 * foto, y la respuesta sigue en ese lugar; si lo quita, ese lugar se va con su
 * respuesta y los demás siguen valiendo, en vez de correrse y acreditar otro.
 * Es el único sitio donde se calcula: el alumno, la calificación y la
 * revisión la piden aquí.
 */
export function imageZoneToken(attemptId: string, questionId: string, zone: Pick<ImageZone, "x" | "y" | "key">): string {
  return opaqueToken("imgzone", attemptId, questionId, zoneKey(zone));
}

/**
 * Ficha opaca de una copia de un elemento de «arrastrar a la imagen». Como la
 * del lugar, no depende de posiciones: va por el id del elemento (el HMAC lo
 * oculta) y el número de copia. Si el maestro reordena o borra elementos con
 * un intento en curso, las demás fichas siguen valiendo; si un elemento se
 * queda con menos lugares, sus copias de más dejan de contar.
 */
export function imageItemToken(attemptId: string, questionId: string, elementId: string, copy: number): string {
  return opaqueToken("imgitem", attemptId, questionId, elementId, copy);
}

/**
 * Respuesta de «arrastrar a la imagen» ({fichaDeLugar: fichaDeElemento}) →
 * elemento puesto en cada lugar, en el orden de `config.zones`. Lo usan la
 * calificación y la revisión, así ambas leen la respuesta igual.
 */
export function imageDragPlacement(
  config: ImageDragConfig,
  answerText: string | null | undefined,
  attemptId: string,
  questionId: string
): (string | undefined)[] {
  const answer = parseMapAnswer(answerText);
  const zoneIndex = new Map(config.zones.map((z, i) => [imageZoneToken(attemptId, questionId, z), i]));
  const elementOf = new Map(
    dragCopies(config).map((cp) => [imageItemToken(attemptId, questionId, cp.elementId, cp.copy), cp.elementId])
  );
  const placed: (string | undefined)[] = new Array(config.zones.length).fill(undefined);
  const used = new Set<string>();
  for (const [zt, it] of Object.entries(answer)) {
    const zi = zoneIndex.get(zt);
    const el = elementOf.get(it);
    // Cada ficha vale una sola vez: mandar la misma en dos lugares no suma
    if (zi === undefined || el === undefined || used.has(it)) continue;
    used.add(it);
    placed[zi] = el;
  }
  return placed;
}

/**
 * Fichas opacas de «Clasificar en grupos»: una por tarjeta y una por grupo,
 * por su id (no por su posición): el maestro puede reordenar o quitar tarjetas
 * con un intento en curso y las demás respuestas siguen valiendo.
 */
export function categorizeCardToken(attemptId: string, questionId: string, cardId: string): string {
  return opaqueToken("catcard", attemptId, questionId, cardId);
}

export function categorizeGroupToken(attemptId: string, questionId: string, groupId: string): string {
  return opaqueToken("catgroup", attemptId, questionId, groupId);
}

/**
 * Fichas opacas de «Completar el texto». Los huecos y sus opciones van por
 * índice (como relacionar y ordenar: editar el texto con intentos abiertos
 * puede mover respuestas). `key` de una palabra del banco: `b{i}` la del hueco
 * i, `d{j}` el distractor j (ver `clozeBankWords`); `k` de una opción: su
 * índice en [canónica, …incorrectas] (ver `clozeOptions`).
 */
export function clozeBlankToken(attemptId: string, questionId: string, index: number): string {
  return opaqueToken("clzblank", attemptId, questionId, index);
}

export function clozeWordToken(attemptId: string, questionId: string, key: string): string {
  return opaqueToken("clzword", attemptId, questionId, key);
}

export function clozeOptionToken(attemptId: string, questionId: string, blank: number, k: number): string {
  return opaqueToken("clzopt", attemptId, questionId, blank, k);
}

/**
 * Respuesta de clasificar ({fichaDeTarjeta: fichaDeGrupo}) → id del grupo
 * donde quedó cada tarjeta (id de tarjeta → id de grupo; las que no se
 * pusieron, o con fichas que no son de esta pregunta, no aparecen). Lo usan la
 * calificación y la revisión, así ambas leen la respuesta igual.
 */
export function categorizePlacement(
  config: CategorizeConfig,
  answerText: string | null | undefined,
  attemptId: string,
  questionId: string
): Record<string, string> {
  const answer = parseMapAnswer(answerText);
  const groupOf = new Map(config.groups.map((g) => [categorizeGroupToken(attemptId, questionId, g.id), g.id]));
  // Sin prototipo: un id de tarjeta nunca choca con algo heredado
  const placed: Record<string, string> = Object.create(null);
  for (const card of config.cards) {
    const group = groupOf.get(answer[categorizeCardToken(attemptId, questionId, card.id)]);
    if (group !== undefined) placed[card.id] = group;
  }
  return placed;
}

/**
 * Respuesta de completar ({fichaDeHueco: texto | fichaDePalabra | fichaDeOpción})
 * → lo puesto en cada hueco como texto, en orden de huecos (undefined = vacío).
 * Escribir: lo escrito. Banco: el texto de la palabra, y cada ficha vale una
 * sola vez (la misma en dos huecos cuenta en el primero). Lista: el texto de la
 * opción, solo si es de ese hueco. Lo usan la calificación y la revisión.
 */
export function clozePlacement(
  config: ClozeConfig,
  answerText: string | null | undefined,
  attemptId: string,
  questionId: string
): (string | undefined)[] {
  const answer = parseMapAnswer(answerText);
  const { blanks } = parseCloze(config.text);
  const words =
    config.mode === "bank"
      ? new Map(clozeBankWords(config).map((w) => [clozeWordToken(attemptId, questionId, w.key), w.text]))
      : null;
  const used = new Set<string>();
  return blanks.map((b, i) => {
    const v = answer[clozeBlankToken(attemptId, questionId, i)];
    if (typeof v !== "string") return undefined;
    if (config.mode === "write") return v.trim() || undefined;
    if (words) {
      const text = words.get(v);
      if (text === undefined || used.has(v)) return undefined;
      used.add(v);
      return text;
    }
    return clozeOptions(b).find((_, k) => clozeOptionToken(attemptId, questionId, i, k) === v);
  });
}
