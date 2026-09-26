import type { CategorizeBoard } from "./categorize";
import type { ClozeBoard } from "./cloze";

/**
 * Tablero de revisión de «Clasificar en grupos» y «Completar el texto»: lo que
 * puso el alumno, si acertó y la solución (o solo la solución, en la vista
 * previa del maestro). Hermano de `ReviewBoard` (image-boards), que es de las
 * preguntas sobre imagen, para no mezclarlo con sus dibujos. Solo viaja con
 * resultados visibles. Cada tipo arma el suyo en su módulo puro
 * (`categorizeBoard`, `clozeBoard`).
 */
export type AnswerBoard = CategorizeBoard | ClozeBoard;
