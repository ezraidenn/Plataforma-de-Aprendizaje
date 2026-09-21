import { between, progressBetween } from "../scene-clock";

export const TEMPLATE_FIELDS_CYCLE_MS = 8000;
export type TemplateFieldKey = "validity" | "qr";

export type TemplateFieldsState = {
  /** Vigencia: diploma de un curso con vigencia (true) o vitalicio (false) */
  withValidity: boolean;
  /** QR: el celular se acerca (0–1) */
  phoneIn: number;
  scanning: boolean;
  verified: boolean;
};

/** Vigencia: con fecha → vitalicio (el renglón se omite). QR: el celular escanea y abre «Certificado válido». */
export function templateFieldsStory(phase: number, field: TemplateFieldKey): TemplateFieldsState {
  if (field === "validity") return { withValidity: phase < 0.5, phoneIn: 0, scanning: false, verified: false };
  return {
    withValidity: true,
    phoneIn: progressBetween(phase, 0.05, 0.3),
    scanning: between(phase, 0.3, 0.5),
    verified: phase >= 0.5,
  };
}
