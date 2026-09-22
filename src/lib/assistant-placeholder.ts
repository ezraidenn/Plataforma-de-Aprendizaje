/**
 * Texto de ayuda del campo del asistente según la página. Enseña qué puede
 * hacer sin manual. Puro: se prueba en `pnpm smoke:assistant`.
 */
export const DEFAULT_PLACEHOLDER = "Habla con la IA o suelta un archivo";

export function placeholderFor(pathname: string): string {
  if (/^\/teach\/students\/[^/]+/.test(pathname)) return "Habla con la IA sobre este alumno";
  if (pathname === "/teach/students") return "Habla con la IA o suelta aquí la lista de alumnos";
  if (/^\/teach\/courses\/[^/]+/.test(pathname)) return "Habla con la IA sobre este curso";
  if (pathname === "/teach/courses") return "Habla con la IA o suelta la lista de cursos";
  return DEFAULT_PLACEHOLDER;
}
