/**
 * Trabajos en segundo plano: la cola avanza sola (en cola → en proceso →
 * terminado) y lo que falla se puede reintentar.
 */
export const JOBS_QUEUE_CYCLE_MS = 12_000;

export type JobRow = {
  title: string;
  status: "pending" | "running" | "done" | "error";
  /** Avance 0–1 mientras corre */
  progress: number;
};

export type JobsQueueState = {
  jobs: JobRow[];
  /** El cursor está sobre «Reintentar» del trabajo con error */
  retrying: boolean;
};

const CONVERT = "Convertir PowerPoint";
const CERT = "Generar certificado";
const FILES = "Acomodar archivos";

export function jobsQueueStory(phase: number): JobsQueueState {
  // Los tres esperan turno
  if (phase < 0.15) {
    return {
      jobs: [
        { title: CONVERT, status: "pending", progress: 0 },
        { title: CERT, status: "pending", progress: 0 },
        { title: FILES, status: "pending", progress: 0 },
      ],
      retrying: false,
    };
  }
  // El primero corre
  if (phase < 0.45) {
    return {
      jobs: [
        { title: CONVERT, status: "running", progress: (phase - 0.15) / 0.3 },
        { title: CERT, status: "pending", progress: 0 },
        { title: FILES, status: "pending", progress: 0 },
      ],
      retrying: false,
    };
  }
  // Termina el primero, el segundo también, y el tercero falla
  if (phase < 0.62) {
    return {
      jobs: [
        { title: CONVERT, status: "done", progress: 1 },
        { title: CERT, status: "done", progress: 1 },
        { title: FILES, status: "error", progress: 0 },
      ],
      retrying: false,
    };
  }
  // El administrador pulsa «Reintentar»
  if (phase < 0.82) {
    return {
      jobs: [
        { title: CONVERT, status: "done", progress: 1 },
        { title: CERT, status: "done", progress: 1 },
        { title: FILES, status: "error", progress: 0 },
      ],
      retrying: true,
    };
  }
  // Y al reintentarlo, sale adelante
  return {
    jobs: [
      { title: CONVERT, status: "done", progress: 1 },
      { title: CERT, status: "done", progress: 1 },
      { title: FILES, status: "running", progress: (phase - 0.82) / 0.18 },
    ],
    retrying: false,
  };
}
