/**
 * Estudiante leído por «Importar con IA»: se revisa y corrige en la vista
 * previa antes de crear nada. Módulo puro (lo usan el navegador y el servidor).
 */
export type StudentDraft = {
  key: string;
  fullName: string;
  email: string;
  /** Grupo, generación o turno si la lista lo indica ("" si no) */
  group: string;
  /** Notas de la IA («Sin correo en el archivo»…); lo que impide importar se calcula en vivo */
  issues: string[];
  /** Archivo de donde salió (cuando se subieron varios) */
  source?: string;
};

export const STUDENT_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normalizeStudentName = (s: string) => s.replace(/\s+/g, " ").trim();
export const normalizeStudentEmail = (s: string) =>
  s.replace(/^mailto:/i, "").replace(/\s+/g, "").toLowerCase();

/** Lo que impide importar la fila (mismas reglas que el CSV); null = lista. */
export function studentDraftProblem(d: Pick<StudentDraft, "fullName" | "email">): string | null {
  if (normalizeStudentName(d.fullName).length < 3) return "Falta el nombre";
  const email = normalizeStudentEmail(d.email);
  if (!email) return "Falta el correo";
  if (!STUDENT_EMAIL_RE.test(email)) return "Correo inválido";
  return null;
}
