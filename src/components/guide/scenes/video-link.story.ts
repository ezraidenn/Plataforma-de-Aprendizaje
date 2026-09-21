/**
 * Video de YouTube: el maestro pega el enlace, la plataforma lo reconoce y
 * muestra la vista previa; del lado del alumno, el video avanza.
 */
export const VIDEO_LINK_CYCLE_MS = 10_000;

export const VIDEO_LINK_URL = "https://youtu.be/NOM-002";

export type VideoLinkState = {
  /** Lo que se ve escrito en el campo */
  typed: string;
  /** El enlace ya se reconoció */
  recognized: boolean;
  /** Se muestra la vista previa */
  preview: boolean;
  /** Avance del alumno en el video (0–1) */
  studentProgress: number;
};

const TYPING_END = 0.42;

export function videoLinkStory(phase: number): VideoLinkState {
  if (phase < 0.08) {
    return { typed: "", recognized: false, preview: false, studentProgress: 0 };
  }
  if (phase < TYPING_END) {
    const done = (phase - 0.08) / (TYPING_END - 0.08);
    const chars = Math.max(1, Math.round(done * VIDEO_LINK_URL.length));
    return { typed: VIDEO_LINK_URL.slice(0, chars), recognized: false, preview: false, studentProgress: 0 };
  }
  if (phase < 0.55) {
    return { typed: VIDEO_LINK_URL, recognized: true, preview: false, studentProgress: 0 };
  }
  // Vista previa y, ya publicado, el avance del alumno
  const watched = phase < 0.7 ? 0 : (phase - 0.7) / 0.3;
  return { typed: VIDEO_LINK_URL, recognized: true, preview: true, studentProgress: watched };
}
