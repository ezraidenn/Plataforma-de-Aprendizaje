import {
  sqliteTable,
  text,
  integer,
  real,
  blob,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// ─────────────────────────────────────────────────────────────────────────────
// Convenciones: PK `id` texto (nanoid). Timestamps en milisegundos Unix.
// `createdAt`/`updatedAt` en todas las tablas de negocio.
// ─────────────────────────────────────────────────────────────────────────────

const timestamps = {
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
};

// ═══════════════════════════════ Identidad ══════════════════════════════════

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    fullName: text("full_name").notNull(),
    role: text("role", { enum: ["admin", "teacher", "student"] }).notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    // Maestro que registró al estudiante (null para cuentas iniciales/admin)
    createdBy: text("created_by"),
    lastLoginAt: integer("last_login_at", { mode: "timestamp_ms" }),
    // Maestros con permiso para editar la identidad de la empresa (logo, portada)
    canEditBranding: integer("can_edit_branding", { mode: "boolean" }).notNull().default(false),
    ...timestamps,
  },
  (t) => [index("users_role_idx").on(t.role), index("users_active_idx").on(t.active)]
);

export const sessions = sqliteTable(
  "sessions",
  {
    // Se guarda el hash SHA-256 del token, nunca el token en claro
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("sessions_user_idx").on(t.userId), index("sessions_expires_idx").on(t.expiresAt)]
);

// ═══════════════════════════════ Archivos ═══════════════════════════════════

export const files = sqliteTable(
  "files",
  {
    id: text("id").primaryKey(),
    originalName: text("original_name").notNull(),
    // Relativo a la carpeta storage/ (nunca ruta absoluta)
    storedPath: text("stored_path").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    uploadedBy: text("uploaded_by")
      .notNull()
      .references(() => users.id),
    kind: text("kind", {
      enum: [
        "course_source",
        "course_render",
        "thumbnail",
        "submission",
        "template_bg",
        "certificate",
        "cover",
        "branding",
        "resource",
        "attachment",
        "editor_image",
      ],
    }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("files_kind_idx").on(t.kind), index("files_uploader_idx").on(t.uploadedBy)]
);

// ═══════════════════════════ Cursos y contenido ═════════════════════════════

export const courses = sqliteTable(
  "courses",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    coverFileId: text("cover_file_id").references(() => files.id),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id),
    status: text("status", { enum: ["draft", "published", "archived"] })
      .notNull()
      .default("draft"),
    // Progresión lineal (true) vs. libre (false); overrideable por ítem
    enforceSequence: integer("enforce_sequence", { mode: "boolean" }).notNull().default(true),
    // Árbol JSON de condiciones de aprobación (ver rules-engine)
    completionRules: text("completion_rules", { mode: "json" }),
    certificateTemplateId: text("certificate_template_id"),
    // Vigencia del certificado: vitalicio, hasta fin de año o N meses tras aprobar
    validityMode: text("validity_mode", { enum: ["lifetime", "calendar_year", "months"] })
      .notNull()
      .default("lifetime"),
    validityMonths: integer("validity_months"),
    ...timestamps,
  },
  (t) => [index("courses_owner_idx").on(t.ownerId), index("courses_status_idx").on(t.status)]
);

// Oleadas de alumnos («Ingreso oct 2026») PROPIAS de cada curso: los filtros de
// un curso solo muestran sus grupos. La misma oleada en otro curso es otro
// grupo con el mismo nombre (se crea al importarla). Cerrar un grupo lo saca
// de las vistas diarias; no borra nada.
export const cohorts = sqliteTable(
  "cohorts",
  {
    id: text("id").primaryKey(),
    // Anulable solo en SQLite (ALTER TABLE no admite NOT NULL sin default y
    // recrear la tabla vaciaría enrollments.cohort_id); la app siempre lo fija.
    courseId: text("course_id").references(() => courses.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: text("status", { enum: ["open", "closed"] })
      .notNull()
      .default("open"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    closedAt: integer("closed_at", { mode: "timestamp_ms" }),
    ...timestamps,
  },
  (t) => [index("cohorts_status_idx").on(t.status), index("cohorts_course_idx").on(t.courseId)]
);

export const enrollments = sqliteTable(
  "enrollments",
  {
    id: text("id").primaryKey(),
    courseId: text("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    studentId: text("student_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    enrolledBy: text("enrolled_by")
      .notNull()
      .references(() => users.id),
    status: text("status", { enum: ["active", "completed", "dropped"] })
      .notNull()
      .default("active"),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    // Ciclo de recertificación: 1 la primera vez, 2 al reinscribir tras vencer…
    cycle: integer("cycle").notNull().default(1),
    // Papelera de bajas: al dar de baja se guarda el estatus que tenía para
    // restaurarlo tal cual (una baja accidental no debe «desaprobar» a nadie)
    droppedAt: integer("dropped_at", { mode: "timestamp_ms" }),
    droppedBy: text("dropped_by").references(() => users.id),
    droppedFrom: text("dropped_from", { enum: ["active", "completed"] }),
    // Oleada a la que pertenece (null = sin grupo, p. ej. matrículas antiguas)
    cohortId: text("cohort_id").references(() => cohorts.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("enrollments_course_student_cycle_uq").on(t.courseId, t.studentId, t.cycle),
    index("enrollments_cohort_idx").on(t.cohortId),
    index("enrollments_student_idx").on(t.studentId),
    index("enrollments_status_idx").on(t.courseId, t.status),
  ]
);

// Árbol ordenable: carpetas y lecciones en una sola tabla (adjacency list).
export const courseItems = sqliteTable(
  "course_items",
  {
    id: text("id").primaryKey(),
    courseId: text("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    parentId: text("parent_id"), // null = raíz del curso; FK a course_items.id
    position: integer("position").notNull(), // orden entre hermanos
    kind: text("kind", {
      enum: ["folder", "document", "video", "text", "exam", "assignment", "resource", "link"],
    }).notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    sequenceMode: text("sequence_mode", { enum: ["inherit", "required", "free"] })
      .notNull()
      .default("inherit"),
    requiredForCompletion: integer("required_for_completion", { mode: "boolean" })
      .notNull()
      .default(true),
    visible: integer("visible", { mode: "boolean" }).notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index("course_items_course_idx").on(t.courseId),
    index("course_items_parent_idx").on(t.parentId, t.position),
  ]
);

// ── Detalle por tipo (Class Table Inheritance, 1:1 con course_items) ─────────

export const itemDocuments = sqliteTable("item_documents", {
  itemId: text("item_id")
    .primaryKey()
    .references(() => courseItems.id, { onDelete: "cascade" }),
  sourceFileId: text("source_file_id").references(() => files.id),
  renderFileId: text("render_file_id").references(() => files.id), // PDF final
  thumbnailFileId: text("thumbnail_file_id").references(() => files.id),
  sourceType: text("source_type", { enum: ["pdf", "ppt", "pptx"] }),
  pageCount: integer("page_count"),
  minSecondsPerPage: integer("min_seconds_per_page").notNull().default(3),
  processingStatus: text("processing_status", {
    enum: ["pending", "processing", "ready", "error"],
  })
    .notNull()
    .default("pending"),
  processingError: text("processing_error"),
}, (t) => [
  // Buscar a qué documento pertenece un archivo (permisos de /api/files y
  // ubicación en disco): sin índice se recorría la tabla completa
  index("item_documents_source_idx").on(t.sourceFileId),
  index("item_documents_render_idx").on(t.renderFileId),
  index("item_documents_thumbnail_idx").on(t.thumbnailFileId),
]);

// Video por ENLACE externo (YouTube/Vimeo) — sin archivo ni procesamiento
export const itemVideos = sqliteTable("item_videos", {
  itemId: text("item_id")
    .primaryKey()
    .references(() => courseItems.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  provider: text("provider", { enum: ["youtube", "vimeo", "other"] }).notNull(),
  videoId: text("video_id"),
  // De la API del player al primer load; editable por el maestro como respaldo
  durationSeconds: integer("duration_seconds"),
  allowSpeedUp: integer("allow_speed_up", { mode: "boolean" }).notNull().default(false),
});

export const itemTexts = sqliteTable("item_texts", {
  itemId: text("item_id")
    .primaryKey()
    .references(() => courseItems.id, { onDelete: "cascade" }),
  contentMd: text("content_md").notNull().default(""),
  minReadSeconds: integer("min_read_seconds").notNull().default(0),
});

export const itemAssignments = sqliteTable("item_assignments", {
  itemId: text("item_id")
    .primaryKey()
    .references(() => courseItems.id, { onDelete: "cascade" }),
  instructionsMd: text("instructions_md").notNull().default(""),
  dueAt: integer("due_at", { mode: "timestamp_ms" }),
  maxScore: integer("max_score").notNull().default(100),
  allowedFileTypes: text("allowed_file_types").notNull().default(".pdf,.docx"),
  allowResubmission: integer("allow_resubmission", { mode: "boolean" }).notNull().default(true),
  allowLate: integer("allow_late", { mode: "boolean" }).notNull().default(true),
});

// Enlace externo (página web, formulario, etc.)
export const itemLinks = sqliteTable("item_links", {
  itemId: text("item_id")
    .primaryKey()
    .references(() => courseItems.id, { onDelete: "cascade" }),
  url: text("url").notNull().default(""),
  description: text("description").notNull().default(""),
});

// Recurso descargable: uno o varios archivos (Word, Excel, ZIP, imágenes...)
export const itemResourceFiles = sqliteTable(
  "item_resource_files",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id")
      .notNull()
      .references(() => courseItems.id, { onDelete: "cascade" }),
    fileId: text("file_id")
      .notNull()
      .references(() => files.id),
    position: integer("position").notNull().default(0),
  },
  (t) => [
    index("item_resource_files_item_idx").on(t.itemId, t.position),
    index("item_resource_files_file_idx").on(t.fileId),
  ]
);

// Adjuntos del maestro en una tarea (PDF de instrucciones, plantillas...)
export const assignmentAttachments = sqliteTable(
  "assignment_attachments",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id")
      .notNull()
      .references(() => courseItems.id, { onDelete: "cascade" }),
    fileId: text("file_id")
      .notNull()
      .references(() => files.id),
    position: integer("position").notNull().default(0),
  },
  (t) => [
    index("assignment_attachments_item_idx").on(t.itemId, t.position),
    index("assignment_attachments_file_idx").on(t.fileId),
  ]
);

export const exams = sqliteTable("exams", {
  itemId: text("item_id")
    .primaryKey()
    .references(() => courseItems.id, { onDelete: "cascade" }),
  instructionsMd: text("instructions_md").notNull().default(""),
  opensAt: integer("opens_at", { mode: "timestamp_ms" }), // ambos null = siempre abierto
  closesAt: integer("closes_at", { mode: "timestamp_ms" }),
  maxAttempts: integer("max_attempts"), // null = ilimitados
  attemptScorePolicy: text("attempt_score_policy", { enum: ["best", "last", "average"] })
    .notNull()
    .default("best"),
  timeLimitMinutes: integer("time_limit_minutes"), // null = sin límite
  passScore: real("pass_score"), // % informativo por examen
  shuffleQuestions: integer("shuffle_questions", { mode: "boolean" }).notNull().default(false),
  // Pool aleatorio: cada intento toma N preguntas al azar del banco (null = todas)
  drawCount: integer("draw_count"),
  showResultsMode: text("show_results_mode", {
    enum: ["immediately", "after_close", "manual"],
  })
    .notNull()
    .default("immediately"),
  // «Publicar resultados» del maestro (null = no publicados)
  resultsPublishedAt: integer("results_published_at", { mode: "timestamp_ms" }),
  // El aviso «ya están disponibles» por cierre ya se revisó (lo usa el worker)
  resultsNotifiedAt: integer("results_notified_at", { mode: "timestamp_ms" }),
});

// ═══════════════════════════════ Exámenes ═══════════════════════════════════

export const questions = sqliteTable(
  "questions",
  {
    id: text("id").primaryKey(),
    examItemId: text("exam_item_id")
      .notNull()
      .references(() => exams.itemId, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    type: text("type", {
      enum: ["single_choice", "multiple_choice", "true_false", "short_text", "matching", "ordering", "open_text"],
    }).notNull(),
    promptMd: text("prompt_md").notNull(),
    points: real("points").notNull().default(1),
    imageFileId: text("image_file_id").references(() => files.id),
    // short_text: variantes aceptadas; matching: pares [{left, right}]; ordering: pasos en orden
    config: text("config", { mode: "json" }),
    ...timestamps,
  },
  (t) => [
    index("questions_exam_idx").on(t.examItemId, t.position),
    index("questions_image_idx").on(t.imageFileId),
  ]
);

export const questionOptions = sqliteTable(
  "question_options",
  {
    id: text("id").primaryKey(),
    questionId: text("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    textMd: text("text_md").notNull(),
    isCorrect: integer("is_correct", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [index("question_options_q_idx").on(t.questionId, t.position)]
);

export const examAttempts = sqliteTable(
  "exam_attempts",
  {
    id: text("id").primaryKey(),
    examItemId: text("exam_item_id")
      .notNull()
      .references(() => exams.itemId, { onDelete: "cascade" }),
    studentId: text("student_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Matrícula (ciclo) del intento: los intentos de 2026 no cuentan en 2027
    enrollmentId: text("enrollment_id").references(() => enrollments.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    // Hora límite absoluta calculada al iniciar (reloj del servidor)
    deadlineAt: integer("deadline_at", { mode: "timestamp_ms" }),
    submittedAt: integer("submitted_at", { mode: "timestamp_ms" }), // null = en curso
    autoScore: real("auto_score"),
    manualScore: real("manual_score"),
    finalScore: real("final_score"), // se publica al quedar todo calificado
    maxScoreSnapshot: real("max_score_snapshot"),
    status: text("status", { enum: ["in_progress", "submitted", "graded"] })
      .notNull()
      .default("in_progress"),
    gradedBy: text("graded_by").references(() => users.id),
    gradedAt: integer("graded_at", { mode: "timestamp_ms" }),
    // Orden de preguntas barajado para este intento (array de ids)
    questionOrder: text("question_order", { mode: "json" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("exam_attempts_enrollment_uq").on(t.examItemId, t.enrollmentId, t.attemptNumber),
    index("exam_attempts_enrollment_idx").on(t.enrollmentId),
    index("exam_attempts_student_idx").on(t.studentId),
    index("exam_attempts_status_idx").on(t.status),
  ]
);

export const attemptAnswers = sqliteTable(
  "attempt_answers",
  {
    id: text("id").primaryKey(),
    attemptId: text("attempt_id")
      .notNull()
      .references(() => examAttempts.id, { onDelete: "cascade" }),
    questionId: text("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    selectedOptionIds: text("selected_option_ids", { mode: "json" }), // array
    answerText: text("answer_text"),
    autoPoints: real("auto_points"), // null para open_text
    manualPoints: real("manual_points"),
    feedbackMd: text("feedback_md"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("attempt_answers_uq").on(t.attemptId, t.questionId),
    index("attempt_answers_attempt_idx").on(t.attemptId),
  ]
);

// ═══════════════════════════ Tracking granular ══════════════════════════════

export const itemProgress = sqliteTable(
  "item_progress",
  {
    id: text("id").primaryKey(),
    enrollmentId: text("enrollment_id")
      .notNull()
      .references(() => enrollments.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .references(() => courseItems.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["locked", "available", "in_progress", "completed"] })
      .notNull()
      .default("available"),
    percent: real("percent").notNull().default(0),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    lastActivityAt: integer("last_activity_at", { mode: "timestamp_ms" }),
    totalSeconds: integer("total_seconds").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("item_progress_uq").on(t.enrollmentId, t.itemId),
    index("item_progress_item_idx").on(t.itemId),
  ]
);

// Detalle documentos: bitmap de páginas (bit N = página N acreditada)
export const documentProgress = sqliteTable("document_progress", {
  itemProgressId: text("item_progress_id")
    .primaryKey()
    .references(() => itemProgress.id, { onDelete: "cascade" }),
  pagesViewed: blob("pages_viewed", { mode: "buffer" }),
  currentPage: integer("current_page").notNull().default(1),
  lastHeartbeatAt: integer("last_heartbeat_at", { mode: "timestamp_ms" }),
  // Página reportada en el último heartbeat (para acreditar permanencia)
  lastReportedPage: integer("last_reported_page"),
  // Segundos ACUMULADOS de permanencia en lastReportedPage (los latidos van
  // cada 10 s: exigir un solo intervalo >= min hacía imposible min > 10)
  pageAccumSeconds: integer("page_accum_seconds").notNull().default(0),
});

// Detalle video: intervalos fusionados [[inicio,fin], ...] en segundos
export const videoProgress = sqliteTable("video_progress", {
  itemProgressId: text("item_progress_id")
    .primaryKey()
    .references(() => itemProgress.id, { onDelete: "cascade" }),
  watchedIntervals: text("watched_intervals", { mode: "json" }).notNull().default("[]"),
  maxPosition: real("max_position").notNull().default(0),
  lastPosition: real("last_position").notNull().default(0),
  lastHeartbeatAt: integer("last_heartbeat_at", { mode: "timestamp_ms" }),
});

export const assignmentSubmissions = sqliteTable(
  "assignment_submissions",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id")
      .notNull()
      .references(() => itemAssignments.itemId, { onDelete: "cascade" }),
    // Matrícula (ciclo) de la entrega: la tarea de 2026 no bloquea la de 2027
    enrollmentId: text("enrollment_id").references(() => enrollments.id, { onDelete: "cascade" }),
    studentId: text("student_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Archivo principal (histórico); las entregas nuevas usan submission_files
    fileId: text("file_id").references(() => files.id),
    comment: text("comment").notNull().default(""),
    // Respuesta escrita (HTML saneado) — estilo Teams
    answerText: text("answer_text").notNull().default(""),
    submittedAt: integer("submitted_at", { mode: "timestamp_ms" }).notNull(),
    isLate: integer("is_late", { mode: "boolean" }).notNull().default(false),
    score: real("score"),
    feedbackMd: text("feedback_md"),
    status: text("status", { enum: ["submitted", "graded", "returned"] })
      .notNull()
      .default("submitted"),
    gradedBy: text("graded_by").references(() => users.id),
    gradedAt: integer("graded_at", { mode: "timestamp_ms" }),
    ...timestamps,
  },
  (t) => [
    index("submissions_item_idx").on(t.itemId),
    index("submissions_student_idx").on(t.studentId),
    index("submissions_status_idx").on(t.status),
    index("submissions_file_idx").on(t.fileId),
  ]
);

export const submissionFiles = sqliteTable(
  "submission_files",
  {
    id: text("id").primaryKey(),
    submissionId: text("submission_id")
      .notNull()
      .references(() => assignmentSubmissions.id, { onDelete: "cascade" }),
    fileId: text("file_id")
      .notNull()
      .references(() => files.id),
    position: integer("position").notNull().default(0),
  },
  (t) => [
    index("submission_files_sub_idx").on(t.submissionId, t.position),
    index("submission_files_file_idx").on(t.fileId),
  ]
);

// ═══════════════════ Certificados, notificaciones, jobs ═════════════════════

export const certificateTemplates = sqliteTable(
  "certificate_templates",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    backgroundFileId: text("background_file_id").references(() => files.id),
    // Campos posicionables: [{key, x, y, fontSize, font, color, align, text?}]
    fields: text("fields", { mode: "json" }).notNull().default("[]"),
    pageSize: text("page_size", { enum: ["letter", "a4"] }).notNull().default("letter"),
    orientation: text("orientation", { enum: ["landscape", "portrait"] })
      .notNull()
      .default("landscape"),
    // Preset de adornos dibujados (null = sin adornos). Ver lib/certificate-decor
    decor: text("decor"),
    ...timestamps,
  },
  (t) => [
    index("cert_templates_owner_idx").on(t.ownerId),
    index("cert_templates_background_idx").on(t.backgroundFileId),
  ]
);

export const certificates = sqliteTable(
  "certificates",
  {
    id: text("id").primaryKey(),
    folio: text("folio").notNull().unique(), // CERT-2026-000123-K7QX
    enrollmentId: text("enrollment_id")
      .notNull()
      .references(() => enrollments.id),
    // Desnormalizados para consultas y para /verify sin joins profundos
    studentId: text("student_id")
      .notNull()
      .references(() => users.id),
    courseId: text("course_id")
      .notNull()
      .references(() => courses.id),
    issuedAt: integer("issued_at", { mode: "timestamp_ms" }).notNull(),
    // Copia de la plantilla al emitir: editarla no altera certificados históricos
    templateSnapshot: text("template_snapshot", { mode: "json" }),
    pdfFileId: text("pdf_file_id").references(() => files.id),
    verificationHash: text("verification_hash").notNull(),
    revoked: integer("revoked", { mode: "boolean" }).notNull().default(false),
    revokedReason: text("revoked_reason"),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    // Vigencia calculada al emitir (null = vitalicio). Congelada como la
    // plantilla: cambiar la política del curso no altera lo ya emitido.
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    // Panel de vencimientos: pendiente, reinscrito o descartado (con motivo)
    renewalState: text("renewal_state", { enum: ["pending", "renewed", "dismissed"] })
      .notNull()
      .default("pending"),
    renewalNote: text("renewal_note"),
    renewalAt: integer("renewal_at", { mode: "timestamp_ms" }),
    renewedEnrollmentId: text("renewed_enrollment_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    index("certificates_student_idx").on(t.studentId),
    index("certificates_course_idx").on(t.courseId),
    index("certificates_pdf_idx").on(t.pdfFileId),
  ]
);

export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type", {
      enum: [
        "course_completed",
        "assignment_submitted",
        "exam_needs_grading",
        "certificate_issued",
        "deadline_reminder",
        "submission_returned",
        "grade_published",
        "results_available",
      ],
    }).notNull(),
    payload: text("payload", { mode: "json" }).notNull().default("{}"),
    readAt: integer("read_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.readAt)]
);

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    type: text("type", {
      enum: [
        "convert_ppt",
        "process_pdf",
        "generate_certificate",
        "relocate_files",
        "cleanup_files",
      ],
    }).notNull(),
    payload: text("payload", { mode: "json" }).notNull().default("{}"),
    status: text("status", { enum: ["pending", "running", "done", "error"] })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    errorMessage: text("error_message"),
    runAfter: integer("run_after", { mode: "timestamp_ms" }),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("jobs_status_idx").on(t.status, t.runAfter)]
);

// Configuración de la plataforma (identidad de empresa, ajustes globales)
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => users.id),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    detail: text("detail", { mode: "json" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("audit_entity_idx").on(t.entity, t.entityId)]
);
