// Tipos serializables que viajan de server components a client components.

export type StudentItemStatus = "completed" | "in_progress" | "available" | "locked";

export type StudentItemKind =
  | "folder"
  | "document"
  | "video"
  | "text"
  | "exam"
  | "assignment"
  | "resource"
  | "link";

export type StudentTreeNode = {
  id: string;
  title: string;
  kind: StudentItemKind;
  /** Ignorado para carpetas. */
  status: StudentItemStatus;
  /** 0–100, del progreso del estudiante en el ítem. */
  percent: number;
  /** "12 páginas", "Lectura", etc. */
  subtext: string | null;
  /** null = no navegable (bloqueado o en preparación). */
  href: string | null;
  /** Ya no hay tipos pendientes de fase: queda en false para todos. */
  comingSoon: boolean;
  /** Título del ítem que hay que completar primero (solo si está bloqueado). */
  blockedByTitle: string | null;
  children: StudentTreeNode[];
};

export type LessonNav = {
  id: string;
  title: string;
  href: string;
  /** El ítem está bloqueado mientras el actual no se complete. */
  locked: boolean;
};

export type LessonData =
  | {
      kind: "document";
      fileUrl: string;
      pageCount: number;
      minSecondsPerPage: number;
      initialPage: number;
      initialCreditedPages: number[];
    }
  | {
      kind: "text";
      contentMd: string;
      minReadSeconds: number;
      initialPercent: number;
      /** Segundos de lectura ya acreditados (arranque del contador). */
      initialCreditedSeconds: number;
    }
  | { kind: "document-unavailable" }
  | ExamLessonData
  | { kind: "exam-unavailable" }
  | VideoLessonData
  | { kind: "video-unavailable" }
  | AssignmentLessonData
  | { kind: "assignment-unavailable" }
  | LinkLessonData
  | { kind: "link-unavailable" }
  | ResourceLessonData;

export type HeartbeatResponse = {
  percent: number;
  completed: boolean;
  creditedPages: number[];
  currentPage: number;
  /** Lecturas: segundos acreditados por el servidor. */
  creditedSeconds?: number;
  preview?: boolean;
};

// ─── Video (Fase 2) ──────────────────────────────────────────────────────────

export type VideoLessonData = {
  kind: "video";
  provider: "youtube" | "vimeo";
  videoId: string;
  /** null = el servidor aún no conoce la duración: el player la reporta en el primer latido */
  durationSeconds: number | null;
  allowSpeedUp: boolean;
  initialPercent: number;
  initialCompleted: boolean;
  lastPosition: number;
  maxPosition: number;
};

export type VideoHeartbeatResponse = {
  percent: number;
  completed: boolean;
  maxPosition: number;
  /** true = con este latido el estudiante APROBÓ el curso completo */
  courseCompleted?: boolean;
  preview?: boolean;
};

// ─── Examen (Fase 2) ─────────────────────────────────────────────────────────

export type QuestionKind =
  | "single_choice"
  | "multiple_choice"
  | "true_false"
  | "short_text"
  | "matching"
  | "ordering"
  | "open_text";

export type RunnerQuestion = {
  id: string;
  type: QuestionKind;
  promptMd: string;
  points: number;
  /** single/multiple/true_false. NUNCA incluye isCorrect: eso no viaja al cliente. */
  options: { id: string; text: string }[];
  /**
   * matching: izquierda fija; derechas barajadas identificadas por un token
   * opaco por intento (el DOM no revela el índice original, C2).
   */
  matching: {
    lefts: string[];
    rights: { token: string; text: string }[];
  } | null;
  /**
   * ordering: pasos en orden revuelto, cada uno con un token opaco por intento
   * (el DOM no revela su lugar correcto). Respuesta: lista de tokens en orden.
   */
  ordering: { steps: { token: string; text: string }[] } | null;
};

export type AttemptDto = {
  id: string;
  attemptNumber: number;
  status: "in_progress" | "submitted" | "graded";
  startedAtMs: number;
  /** Hora límite absoluta fijada con el reloj del SERVIDOR. */
  deadlineAtMs: number | null;
  questionOrder: string[];
};

export type SavedAnswer = {
  questionId: string;
  selectedOptionIds: string[] | null;
  answerText: string | null;
};

export type PastAttempt = {
  number: number;
  /** null = resultados aún ocultos o intento sin calificar. */
  percent: number | null;
  status: "submitted" | "graded";
  submittedAtMs: number | null;
};

export type ExamLessonData = {
  kind: "exam";
  instructionsMd: string;
  /** Preguntas POR INTENTO (drawCount si hay pool aleatorio; si no, el banco). */
  questionCount: number;
  timeLimitMinutes: number | null;
  passScore: number | null;
  maxAttempts: number | null;
  scorePolicy: "best" | "last" | "average";
  showResultsMode: "immediately" | "after_close" | "manual";
  /** El alumno ya puede ver su calificación (regla resultsVisible). */
  resultsVisible: boolean;
  opensAtMs: number | null;
  closesAtMs: number | null;
  windowState: "not_open" | "open" | "closed";
  attemptsUsed: number;
  pastAttempts: PastAttempt[];
  /**
   * Intento en curso (con sus respuestas guardadas) para retomar. Las
   * preguntas viajan SOLO aquí o en la respuesta de startAttemptAction:
   * la pantalla de inicio nunca recibe el banco (C4).
   */
  resume: {
    attempt: AttemptDto;
    answers: SavedAnswer[];
    questions: RunnerQuestion[];
  } | null;
  /** Reloj del servidor al renderizar (para corregir el offset local). */
  serverNowMs: number;
};

// ─── Recurso descargable y enlace externo ────────────────────────────────────

export type DownloadableFile = {
  fileId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
};

export type LinkLessonData = {
  kind: "link";
  url: string;
  description: string;
  initialCompleted: boolean;
};

export type ResourceLessonData = {
  kind: "resource";
  files: DownloadableFile[];
  initialCompleted: boolean;
};

// ─── Tarea (Fase 3) ──────────────────────────────────────────────────────────

export type SubmissionDto = {
  id: string;
  /** Primer archivo (compat). null si la entrega fue solo texto. */
  fileId: string | null;
  /** Nombre original del primer archivo entregado. */
  fileName: string;
  /** Todos los archivos de la entrega. */
  files: { fileId: string; name: string; sizeBytes: number }[];
  /** Respuesta escrita (HTML saneado). */
  answerText: string;
  comment: string;
  submittedAtMs: number;
  isLate: boolean;
  status: "submitted" | "graded" | "returned";
  /** Solo con status graded (puntos sobre maxScore de la tarea). */
  score: number | null;
  /** Retroalimentación del maestro (graded o returned). */
  feedbackMd: string | null;
};

export type AssignmentLessonData = {
  kind: "assignment";
  instructionsMd: string;
  /** Material de apoyo adjuntado por el maestro (descargable). */
  attachments: DownloadableFile[];
  dueAtMs: number | null;
  maxScore: number;
  /** Extensiones aceptadas tal cual van al accept del input (".pdf,.docx"). */
  allowedFileTypes: string;
  allowResubmission: boolean;
  allowLate: boolean;
  /** Entrega más reciente del alumno; null = aún sin entregar. */
  latest: SubmissionDto | null;
  /** Reloj del servidor al renderizar (la fecha límite se compara contra él). */
  serverNowMs: number;
};

export type ReviewResult = "correct" | "partial" | "incorrect" | "pending";

export type ReviewEntry = {
  questionId: string;
  promptMd: string;
  points: number;
  /** null = pendiente de calificación manual (open_text). */
  earnedPoints: number | null;
  result: ReviewResult;
  yourAnswer: string;
  /** null cuando no aplica mostrarla (open_text). */
  correctAnswer: string | null;
};
