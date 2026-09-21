/**
 * Manifiesto de capturas de la guía. id = `${rol}-${sección}-${paso}` (mismo
 * esquema que usa la guía para buscar /guide/<id>.jpg). `hl` remarca
 * elementos por texto (contiene, sin distinguir mayúsculas) o selector.
 */
module.exports = (d) => {
  const c = d.courseId;
  const it = d.items;
  const dlg = (label) => [{ sel: "[role=dialog]", label, pad: 4, dim: false }];
  const menu = (label) => [{ sel: "[role=menu]", label, pad: 4 }];
  const T = (id, path, extra = {}) => ({ id, role: "teacher", path, ...extra });
  const S = (id, path, extra = {}) => ({ id, role: "student", path, ...extra });
  const A = (id, path, extra = {}) => ({ id, role: "admin", path, ...extra });
  const item = (kind) => it[kind]?.title ?? "";

  return [
    // ── Maestro ─────────────────────────────────────────────────────────────
    T("teacher-inicio-1", "/teach/dashboard", {
      hl: [
        { sel: 'aside nav', label: "Menú: un color por sección", dim: false, pad: 4 },
        { sel: 'aside a[data-section="grading"]', label: "Pendientes por calificar", dim: false },
      ],
    }),
    T("teacher-inicio-2", "/teach/dashboard", {
      actions: [{ type: "click", sel: 'header button:not([aria-label="Abrir menú"])', wait: 900 }],
      hl: [{ sel: "[data-radix-popper-content-wrapper]", label: "Notificaciones: entregas, cursos completados, certificados", pad: 4 }],
    }),
    T("teacher-curso-1", "/teach/courses", {
      actions: [{ type: "click", text: "Nuevo curso", tag: "button", wait: 700 }],
      hl: dlg("Completa y crea"),
    }),
    T("teacher-curso-2", `/teach/courses/${c}/settings`, {
      hl: [
        { text: "Ajustes", tag: "a", exact: true, label: "Pestaña Ajustes", dim: false },
        { text: "Imagen del curso", tag: "div,h3,h4", label: "Imagen del curso", pad: 10 },
      ],
      scrollTo: { text: "Imagen del curso", tag: "div,h3,h4" },
    }),
    T("teacher-curso-3", `/teach/courses/${c}/content`, {
      actions: [{ type: "click", text: "Publicado", tag: "button", wait: 700 }],
      hl: menu("Estado del curso → Publicar / Archivar"),
    }),
    T("teacher-contenido-1", `/teach/courses/${c}/content`, {
      actions: [{ type: "click", text: "Agregar", tag: "button", exact: true, wait: 700 }],
      hl: menu("Tipos de contenido (el árbol de la izquierda se reordena arrastrando)"),
    }),
    T("teacher-contenido-2", `/teach/courses/${c}/content`, {
      actions: [{ type: "click", text: item("document"), tag: "button,a,div,span", wait: 900 }],
      hl: [{ text: "Segundos mínimos", tag: "label", label: "Panel de detalle del documento", pad: 14 }],
    }),
    T("teacher-contenido-3", `/teach/courses/${c}/content`, {
      actions: [{ type: "click", text: item("text"), tag: "button,a,div,span", wait: 1200 }],
      hl: [{ sel: ".ProseMirror", label: "Editor con formato (pega desde Word/Excel)", pad: 8 }],
    }),
    T("teacher-contenido-4", `/teach/courses/${c}/content`, {
      actions: [{ type: "click", text: item("video"), tag: "button,a,div,span", wait: 900 }],
      hl: [{ text: "Enlace", tag: "label", label: "Pega el enlace de YouTube", pad: 12 }],
    }),
    // «Importar con IA» solo sale con una clave de OpenAI guardada en Configuración
    T("teacher-contenido-5", `/teach/courses/${c}/items/${it.exam?.id}/edit`, {
      hl: [
        { text: "Intentos", tag: "label", label: "Configuración del examen", pad: 12 },
        { text: "Pregunta", tag: "h2,h3,h4,p,span", label: "Preguntas", pad: 8 },
        { text: "Ver como alumno", tag: "button", exact: true, label: "Vista previa, sin guardar", dim: false },
        { text: "Importar con IA", tag: "button", exact: true, label: "Preguntas desde un archivo", dim: false },
      ],
    }),
    T("teacher-contenido-6", `/teach/courses/${c}/content`, {
      actions: [{ type: "click", text: item("assignment"), tag: "button,a,div,span", wait: 1200 }],
      scrollTo: { text: "Material de apoyo", tag: "h3,h4,p,span,div" },
      hl: [{ text: "Material de apoyo", tag: "h3,h4,p,span,div", label: "Adjuntos del maestro", pad: 12 }],
    }),
    T("teacher-contenido-7", `/teach/courses/${c}/content`, {
      actions: [{ type: "click", text: item("resource"), tag: "button,a,div,span", wait: 1000 }],
      hl: [{ text: "El alumno completa el recurso", tag: "p", label: "Archivos del recurso: sube varios, reordena, quita", pad: 12 }],
    }),
    T("teacher-contenido-8", `/teach/courses/${c}/content`, {
      actions: [{ type: "click", text: item("link"), tag: "button,a,div,span", wait: 1000 }],
      hl: [{ text: "URL del enlace", tag: "label", label: "URL y descripción · Probar enlace", pad: 12 }],
    }),
    T("teacher-contenido-9", `/teach/courses/${c}/content`, {
      actions: [{ type: "click", text: item("text"), tag: "button,a,div,span", wait: 1800 }],
      scrollTo: { text: "Requerido para completar", tag: "label,span,p" },
      hl: [
        { text: "Requerido para completar", tag: "label,span,p", label: "Requerido para completar", pad: 10 },
        { text: "Edición masiva", tag: "a,button", label: "Carga masiva CSV", dim: false },
      ],
    }),
    T("teacher-reglas-1", `/teach/courses/${c}/rules`, {
      hl: [
        { sel: '[aria-label="Cómo se combinan las condiciones"]', label: "Todas (Y) o al menos una (O)", dim: false, pad: 4 },
        { text: "Condición", tag: "button", label: "Agrega condiciones", pad: 8 },
      ],
    }),
    T("teacher-reglas-2", `/teach/courses/${c}/students`, {
      hl: [{ sel: "table", label: "Estado y avance de cada alumno según las reglas", pad: 4, dim: false }],
    }),
    T("teacher-alumnos-1", "/teach/students", {
      actions: [{ type: "click", text: "Nuevo", tag: "button", exact: true, wait: 900 }],
      hl: dlg("Nombre, correo y contraseña temporal"),
    }),
    T("teacher-alumnos-2", `/teach/students/${d.studentId}`, {
      actions: [{ type: "click", text: "Matricular en cursos", tag: "button", wait: 900 }],
      hl: dlg("Marca varios cursos y confirma"),
    }),
    T("teacher-alumnos-3", "/teach/students", {
      actions: [{ type: "click", text: "Importar", tag: "button,a", wait: 900 }],
      hl: [{ sel: "[role=dialog]", label: "CSV con nombre y correo", pad: 4, dim: false }],
    }),
    T("teacher-alumnos-4", `/teach/students/${d.graduateId}`, {
      hl: [
        { text: "Portafolio", tag: "button,a", label: "Portafolio ZIP", dim: false },
        { text: "Certificados", tag: "h2,h3,h4,div", label: "Certificados del alumno", pad: 8, dim: false },
      ],
    }),
    // Grupos y papelera (F8)
    T("teacher-grupos-1", "/teach/groups", {
      hl: [
        { sel: '[aria-label="Estado de los grupos"]', label: "Abiertos · Cerrados · Todos", dim: false },
        { text: "Nuevo grupo", tag: "button", label: "Crea una generación", dim: false },
      ],
    }),
    T("teacher-grupos-2", `/teach/courses/${c}/students`, {
      actions: [
        { type: "click", text: "Matricular estudiantes", tag: "button", wait: 900 },
        { type: "click", text: "Traer grupo de otro curso", tag: "[role=tab],button", wait: 700 },
      ],
      hl: dlg("Alumnos sueltos o un grupo completo de otro curso"),
    }),
    T("teacher-grupos-3", `/teach/courses/${c}/students`, {
      hl: [{ sel: '[aria-label="Filtrar por grupo"]', label: "Filtro de grupo (también en Reportes y Estadísticas)", dim: false }],
    }),
    T("teacher-grupos-4", `/teach/courses/${c}/students`, {
      actions: [{ type: "click", text: "Papelera", tag: "button", wait: 900 }],
      hl: [
        { text: "Certificado conservado", tag: "span,div", label: "La baja no toca el certificado", dim: false },
        { text: "Restaurar", tag: "button", exact: true, label: "Vuelve tal como estaba", dim: false },
      ],
    }),
    T("teacher-calificar-1", "/teach/grading", {
      actions: [
        { type: "click", text: "Croquis", tag: "button,a,li,div", wait: 2500 },
        { type: "click", text: "Ver", tag: "button", exact: true, wait: 1500 },
      ],
      hl: [
        { text: "Ocultar", tag: "button", exact: true, label: "Ver / Ocultar sin descargar · ⤓ descarga", dim: false },
        { text: "Puntos", tag: "label", label: "Puntos y retroalimentación", pad: 12, dim: false },
      ],
    }),
    T("teacher-calificar-2", "/teach/grading", {
      actions: [{ type: "click", text: "Examen", tag: "button,a,li,div", wait: 1200 }],
      hl: [{ text: "Puntos", tag: "label", label: "Puntaje de la pregunta abierta", pad: 12 }],
    }),
    T("teacher-reportes-1", `/teach/reports?course=${c}`, {
      hl: [
        { sel: "table", label: "Matriz alumno × lección", pad: 4, dim: false },
        { text: "Exportar CSV", tag: "a,button", label: "Exportar CSV", dim: false },
      ],
    }),
    T("teacher-reportes-2", `/teach/courses/${c}/stats`, {
      scrollTo: { text: "Distribución de avance", tag: "h2,h3,h4,div" },
      hl: [{ text: "Distribución de avance", tag: "h2,h3,h4,div", label: "Distribución de avance", pad: 12 }],
    }),
    T("teacher-certificados-1", `/teach/templates/${d.templateId}`, {
      height: 1250,
      hl: [
        { text: "Generar PDF de prueba", tag: "button", label: "Prueba el resultado en PDF", dim: false },
        { text: "Agregar campo", tag: "button", label: "Campos: agrega y muestra/oculta con 👁", dim: false },
        { text: "Adornos", tag: "p", exact: true, label: "Estilo del diploma (7 presets)", dim: false, pad: 6 },
      ],
    }),
    T("teacher-certificados-2", `/teach/templates/${d.templateId}`, {
      height: 1100,
      actions: [{ type: "click", sel: '[aria-label^="Campo "]', wait: 500 }],
      hl: [{ sel: '[aria-label="Herramientas del lienzo"]', label: "Alinear · distribuir · imán · cuadrícula · reglas", pad: 4, dim: false }],
    }),
    T("teacher-certificados-3", "/teach/templates", {
      scrollTo: { text: "Emitidos", tag: "h2,h3,h4,div,p" },
      hl: [{ text: "Emitidos", tag: "h2,h3,h4,div,p", label: "Certificados emitidos · Revocar", pad: 10 }],
    }),
    T("teacher-certificados-4", "/teach/templates", {
      hl: [{ text: "ZIP", tag: "a,button", label: "Descarga física en ZIP", dim: false }],
    }),
    // Vigencia y recertificación (F8)
    T("teacher-vencimientos-1", `/teach/courses/${d.auxCourseId}/settings`, {
      scrollTo: { sel: "#vigencia" },
      hl: [{ sel: "#vigencia", label: "Vitalicio · año calendario · meses", pad: 6 }],
    }),
    T("teacher-vencimientos-2", `/teach/templates/${d.templateId}`, {
      height: 1100,
      settle: 2500,
      // La página hace scroll suave: primero llevar el botón a la vista y luego abrir el menú
      actions: [
        { type: "scroll", text: "Agregar campo", tag: "button", wait: 900 },
        { type: "click", text: "Agregar campo", tag: "button", wait: 900 },
      ],
      hl: [{ text: "Vigencia", tag: "[role=menuitem]", label: "Campo «Vigencia»", dim: false }],
    }),
    T("teacher-vencimientos-3", "/teach/renewals?tab=expired", {
      hl: [
        { sel: '[aria-label="Vista de vencimientos"]', label: "Por vencer · Vencidos", dim: false },
        { text: "Cuenta desactivada", tag: "span,div", label: "Ya no está en la empresa", dim: false },
      ],
    }),
    T("teacher-vencimientos-4", "/teach/renewals?tab=expired", {
      actions: [
        { type: "click", sel: '[aria-label^="Seleccionar: "]', wait: 300 },
        { type: "click", text: "Reinscribir", tag: "button", wait: 900 },
      ],
      hl: dlg("Ciclo nuevo en cero: elige su grupo"),
    }),
    T("teacher-ayuda-1", `/teach/courses/${c}/settings`, {
      actions: [{ type: "click", sel: 'button[aria-label="Cómo funciona: Progresión secuencial estricta"]', wait: 2500 }],
      hl: [{ sel: "[data-radix-popper-content-wrapper]", label: "Animación con tu valor actual", pad: 4, dim: false }],
    }),
    T("teacher-ayuda-2", "/teach/ayuda", {
      settle: 3000,
      hl: [{ sel: "article[data-topic]", label: "Cada ajuste con controles para probar valores", pad: 6 }],
    }),
    T("teacher-ajustes-1", "/ajustes", {
      hl: [{ text: "Contraseña", tag: "h3,h4,div", label: "Nombre y contraseña", pad: 10 }],
    }),
    T("teacher-ajustes-2", "/ajustes", {
      scrollTo: { text: "Identidad de la empresa", tag: "h3,h4,div" },
      hl: [{ text: "Identidad de la empresa", tag: "h3,h4,div", label: "Logo, nombre y portada", pad: 10 }],
    }),

    // ── Estudiante ──────────────────────────────────────────────────────────
    S("student-entrar-1", "/login", {
      as: "none",
      mobile: true,
      hl: [{ sel: "input[name=email]", label: "Correo y contraseña", pad: 8, dim: false }, { sel: "button[type=submit]", label: "Entrar", dim: false }],
    }),
    S("student-entrar-2", "/dashboard", {
      mobile: true,
      hl: [{ text: "Continuar", tag: "a,button", label: "Retoma donde te quedaste", dim: false }, { sel: 'button[aria-label="Abrir menú"]', label: "Menú ☰", dim: false }],
    }),
    S("student-curso-1", `/courses/${c}`, {
      hl: [{ text: "Módulo 1", tag: "div,li,span,p", label: "Estados: ✓ hecho · ◐ en curso · 🔒 bloqueado", pad: 6, dim: false }],
    }),
    S("student-curso-2", `/courses/${c}/items/${it.document?.id}`, {
      as: "graduate",
      hl: [
        { sel: "[role=timer]", label: "Contador: página y documento", dim: false },
        { text: "Anterior", tag: "button", label: "Avanza página por página", dim: false },
      ],
    }),
    S("student-curso-3", `/courses/${c}/items/${it.text?.id}`, {
      as: "graduate",
      hl: [
        { sel: "[role=timer]", label: "Tiempo mínimo de lectura", dim: false },
        { text: "Siguiente", tag: "a,button", label: "Al cumplir el tiempo → Siguiente", pad: 6, dim: false },
      ],
    }),
    S("student-curso-4", `/courses/${c}/items/${it.video?.id}`, {
      as: "videoReady",
      settle: 2200,
      hl: [{ sel: "[role=timer]", label: "Cuánto video falta (solo cuenta lo visto)", dim: false }],
    }),
    S("student-curso-5", `/courses/${c}/items/${it.resource?.id}`, {
      as: "graduate",
      hl: [{ sel: 'a[href*="/api/files/"]', label: "Descarga cualquiera para marcar visto", pad: 6, dim: false }],
    }),
    S("student-examen-1", `/courses/${c}/items/${it.exam?.id}`, {
      as: "graduate",
      hl: [{ text: "Intentos", tag: "span,p,div,dt", label: "Intentos, tiempo y mínimo", pad: 10 }],
    }),
    S("student-examen-2", `/courses/${c}/items/${it.exam?.id}`, {
      as: "examReady",
      actions: [{ type: "click", text: "Comenzar intento", tag: "button", wait: 1800 }],
      hl: [{ text: "Enviar", tag: "button", label: "Envía cuando termines", dim: false }],
    }),
    S("student-examen-3", `/courses/${c}/items/${it.exam?.id}`, {
      as: "graduate",
      hl: [{ text: "Calificación", tag: "span,p,div,dt,h3", label: "Tu resultado", pad: 8 }],
    }),
    S("student-tarea-1", `/courses/${c}/items/${it.assignment?.id}`, {
      as: "assignReady",
      hl: [
        { sel: ".ProseMirror", label: "1 · Tu respuesta", pad: 8, dim: false },
        { text: "Entregar", tag: "button", label: "3 · Entregar", dim: false },
      ],
    }),
    S("student-tarea-2", `/courses/${c}/items/${it.assignment?.id}`, {
      as: "assignReady",
      hl: [{ text: "Entrega:", tag: "span,p,div", label: "Fecha límite y puntos", pad: 8 }],
    }),
    S("student-tarea-3", `/courses/${c}/items/${it.assignment?.id}`, {
      as: "graduate",
      scrollTo: { text: "Retroalimentación", tag: "h3,h4,p,span,div" },
      hl: [{ text: "Retroalimentación", tag: "h3,h4,p,span,div", label: "Puntos y comentarios del instructor", pad: 10 }],
    }),
    S("student-certificado-1", "/dashboard", {
      as: "graduate",
      scrollTo: { text: "Mis certificados", tag: "h2,h3" },
      hl: [{ text: "Descargar PDF", tag: "a,button", label: "Descargar PDF", dim: false }],
    }),
    S("student-certificado-2", `/verify/${d.folio}`, {
      as: "none",
      hl: [{ text: "Certificado", tag: "h1,h2,p,div", label: "Verificación pública por QR", pad: 12 }],
    }),
    S("student-certificado-3", "/dashboard", {
      as: "graduate",
      scrollTo: { text: "Mis certificados", tag: "h2,h3" },
      hl: [{ text: "Vigente hasta", tag: "span,div", label: "Vigencia del certificado", dim: false }],
    }),
    S("student-ajustes-1", "/ajustes", {
      hl: [{ text: "Contraseña", tag: "h3,h4,div", label: "Cambia tu contraseña", pad: 10 }],
    }),
    S("student-ajustes-2", "/dashboard", {
      actions: [{ type: "click", sel: 'header button:not([aria-label="Abrir menú"])', wait: 900 }],
      hl: [{ sel: "[data-radix-popper-content-wrapper]", label: "Notificaciones", pad: 4 }],
    }),

    // ── Administrador ───────────────────────────────────────────────────────
    A("admin-usuarios-1", "/admin/users", {
      actions: [{ type: "click", text: "Nuevo usuario", tag: "button", wait: 900 }],
      hl: dlg("Nombre, correo, rol y contraseña temporal"),
    }),
    A("admin-usuarios-2", "/admin/users", {
      actions: [{ type: "click", sel: "table tbody tr:first-child button:last-of-type", wait: 800 }],
      hl: menu("Acciones por usuario"),
    }),
    A("admin-usuarios-3", "/admin/users", {
      hl: [{ text: "Activo", tag: "span,td", exact: true, label: "Estado de la cuenta", pad: 6 }],
    }),
    A("admin-usuarios-4", "/admin/users?role=teacher", {
      hl: [{ text: "Identidad", tag: "span,td", label: "Permiso de identidad", pad: 6 }],
    }),
    A("admin-cursos-1", "/admin/courses", {
      actions: [{ type: "click", sel: "table tbody tr:first-child button:last-of-type", wait: 800 }],
      hl: menu("Reasignar dueño"),
    }),
    A("admin-identidad-1", "/ajustes", {
      scrollTo: { text: "Identidad de la empresa", tag: "h3,h4,div" },
      hl: [{ text: "Identidad de la empresa", tag: "h3,h4,div", label: "Logo y nombre", pad: 10 }],
    }),
    A("admin-identidad-2", "/ajustes", {
      scrollTo: { text: "Mostrar portada", tag: "label,span,p" },
      hl: [{ text: "Mostrar portada", tag: "label,span,p", label: "Portada: vectorial o foto, dónde se ve", pad: 10 }],
    }),
    A("admin-operacion-1", "/admin/settings", {
      scrollTo: { text: "Trabajos", tag: "h2,h3,h4,div" },
      hl: [{ text: "Trabajos", tag: "h2,h3,h4,div", label: "Cola de trabajos · Reintentar", pad: 10 }],
    }),
    A("admin-operacion-2", "/admin/settings", {
      scrollTo: { text: "Auditoría", tag: "h2,h3,h4,div" },
      hl: [{ text: "Auditoría", tag: "h2,h3,h4,div", label: "Bitácora de auditoría", pad: 10 }],
    }),
    // 3 y 4: almacenamiento (pasos nuevos de la guía)
    A("admin-operacion-3", "/admin/settings", {
      scrollTo: { sel: "#storage-root" },
      hl: [
        { sel: "#storage-root", label: "Escribe la ruta (disco o \\NAS\Recurso)", pad: 8, dim: false },
        { text: "Probar", tag: "button", exact: true, label: "Comprueba acceso y escritura", dim: false },
      ],
    }),
    A("admin-operacion-4", "/teach/templates", {
      scrollTo: { text: "Emitidos", tag: "h2,h3,h4,div,p" },
      hl: [
        {
          text: "Emitidos",
          tag: "h2,h3,h4,div,p",
          label: "Los PDF se generan al descargar (no ocupan disco)",
          pad: 10,
        },
      ],
    }),
    A("admin-operacion-5", "/admin/settings", {
      scrollTo: { text: "Respaldo", tag: "h2,h3,h4,div,p" },
      hl: [{ text: "Respaldo", tag: "h2,h3,h4,div,p", label: "Respaldos", pad: 10 }],
    }),
    A("admin-operacion-6", "/admin/settings", {
      hl: [{ sel: "header", label: "Administración · Configuración", pad: 0, dim: false }],
    }),
    A("admin-operacion-7", "/admin/settings", {
      scrollTo: { sel: "[data-ai-card]" },
      hl: [
        { sel: "[data-ai-card]", label: "Clave de OpenAI: se guarda cifrada", pad: 8 },
        { text: "Probar conexión", tag: "button", exact: true, label: "Comprueba la clave sin gastar", dim: false },
      ],
    }),
  ];
};
