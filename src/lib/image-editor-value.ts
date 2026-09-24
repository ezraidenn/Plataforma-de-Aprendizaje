/**
 * Valor del editor de preguntas sobre imagen (la foto y su config): lo que se
 * abre, la forma que debe tener y lo que impediría guardar. Puro (sin DOM):
 * lo usa el editor y lo prueba `pnpm smoke:image`.
 */
import {
  imageClickProblem,
  imageDragProblem,
  round4,
  sanitizeImageConfig,
  type IconSize,
  type ImageClickConfig,
  type ImageDragConfig,
  type ImageElement,
  type ImageQuestionType,
  type ImageZone,
  type Point,
} from "./image-questions";
import { elementSize } from "./image-layout";

export type ImageQuestionValue = { imageFileId: string | null; config: ImageDragConfig | ImageClickConfig };

/**
 * Lo guardado → valor del editor, sin lo ilegible. Sin nada guardado, una
 * pregunta vacía (precisión normal). Solo lo usan las de imagen. En «arrastrar»,
 * cada elemento sale con su tamaño: el de una pregunta de antes (el común
 * `iconSize`) pasa a cada uno y `iconSize` ya no sigue, así lo que se guarde
 * es por elemento y se ve igual que antes.
 */
export function initialImageValue(type: string, imageFileId: string | null, raw: unknown): ImageQuestionValue {
  const isPoint = (p: Partial<Point> | null | undefined): p is Point =>
    typeof p?.x === "number" && typeof p?.y === "number";
  if (type === "image_click") {
    const c = sanitizeImageConfig("image_click", raw) as Partial<ImageClickConfig>;
    return {
      imageFileId,
      config: { aspect: c.aspect ?? 0, precision: c.precision ?? "md", spots: (c.spots ?? []).filter(isPoint) },
    };
  }
  const c = sanitizeImageConfig("image_drag", raw) as {
    aspect?: number;
    iconSize?: IconSize;
    elements?: Partial<ImageElement>[];
    zones?: Partial<ImageZone>[];
  };
  return {
    imageFileId,
    config: {
      aspect: c.aspect ?? 0,
      elements: (c.elements ?? [])
        .filter(
          (e): e is ImageElement => !!e.id && (e.kind === "icon" ? !!e.fileId : e.kind === "text" && typeof e.text === "string")
        )
        .map((e) => ({ ...e, size: e.size ?? round4(elementSize(e, c.iconSize)) })),
      zones: (c.zones ?? []).filter(
        (z): z is ImageZone => typeof z.x === "number" && typeof z.y === "number" && typeof z.elementId === "string"
      ),
    },
  };
}

/**
 * El valor con la forma de su tipo. Si no la tiene (un borrador que cambió de
 * tipo), uno vacío de ese tipo con la misma foto y proporción. Ojo: lo que no
 * «encaja» se tira, así que en «arrastrar» solo se piden las listas (el
 * `iconSize` de antes ya no viene: exigirlo borraría todo lo armado).
 */
export function shapedImageValue(type: ImageQuestionType, value: ImageQuestionValue): ImageQuestionValue {
  const c = value.config as Partial<ImageDragConfig & ImageClickConfig>;
  const fits =
    type === "image_drag"
      ? Array.isArray(c.elements) && Array.isArray(c.zones)
      : Array.isArray(c.spots) && typeof c.precision === "string";
  if (fits) return value;
  const fresh = initialImageValue(type, value.imageFileId, null);
  return { imageFileId: value.imageFileId, config: { ...fresh.config, aspect: c.aspect ?? 0 } };
}

/** El problema que impediría guardar (el mismo que revisa el servidor), o null. */
export function imageQuestionProblem(type: ImageQuestionType, value: ImageQuestionValue): string | null {
  const v = shapedImageValue(type, value);
  return type === "image_drag"
    ? imageDragProblem(v.config, !!v.imageFileId)
    : imageClickProblem(v.config, !!v.imageFileId);
}
