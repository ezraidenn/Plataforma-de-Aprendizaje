/**
 * Segunda confirmación de los borrados definitivos (cursos, grupos, papelera):
 * escribir esta palabra. Se comprueba en el navegador para habilitar el botón
 * y otra vez en el servidor.
 */
export const DELETE_CONFIRM_WORD = "ELIMINAR";

export function isDeleteConfirmed(typed: string): boolean {
  return typed.trim().toUpperCase() === DELETE_CONFIRM_WORD;
}
