// Utilidades de formato propias del panel de administración.

/** Bytes → "512 KB" / "34.2 MB" / "1.20 GB". */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 MB";
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.max(1, Math.round(kb))} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

export const ROLE_LABEL: Record<"admin" | "teacher" | "student", string> = {
  admin: "Administrador",
  teacher: "Maestro",
  student: "Estudiante",
};

export const JOB_TYPE_LABEL: Record<string, string> = {
  convert_ppt: "Convertir presentación (PPT)",
  process_pdf: "Procesar PDF",
  generate_certificate: "Generar certificado",
};

export const JOB_STATUS_LABEL: Record<string, string> = {
  pending: "En cola",
  running: "En proceso",
  done: "Terminado",
  error: "Error",
};

const AUDIT_ACTION_LABEL: Record<string, string> = {
  create_user: "Creó un usuario",
  reset_password: "Restableció una contraseña",
  activate_user: "Activó una cuenta",
  deactivate_user: "Desactivó una cuenta",
  change_role: "Cambió un rol",
  reassign_course: "Reasignó un curso",
  archive_course: "Archivó un curso",
  retry_job: "Reintentó un trabajo",
  import_csv: "Importó estudiantes por CSV",
  publish_exam_results: "Publicó los resultados de un examen",
  hide_exam_results: "Ocultó los resultados de un examen",
  ai_import_exam: "Importó preguntas con IA",
  import_exam_csv: "Importó preguntas por CSV",
  update_ai_settings: "Configuró la IA (OpenAI)",
  clear_ai_settings: "Quitó la clave de IA",
  create_student: "Alta de estudiante",
  reset_student_password: "Restablecer contraseña de estudiante",
  activate_student: "Activar estudiante",
  deactivate_student: "Desactivar estudiante",
  create_course: "Crear curso",
  create_template: "Crear plantilla",
  transfer_template: "Transferir plantilla",
  enroll_students: "Inscribir estudiantes",
  download_certificates_zip: "Descargar certificados (ZIP)",
};

const AUDIT_ENTITY_LABEL: Record<string, string> = {
  users: "Usuarios",
  courses: "Cursos",
  jobs: "Trabajos",
  certificates: "Certificados",
  enrollments: "Matrículas",
  files: "Archivos",
  exams: "Exámenes",
  app_settings: "Configuración",
  certificate_templates: "Plantillas",
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABEL[action] ?? action.replaceAll("_", " ");
}

export function auditEntityLabel(entity: string): string {
  return AUDIT_ENTITY_LABEL[entity] ?? entity;
}
