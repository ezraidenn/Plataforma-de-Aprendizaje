/**
 * Certificados sin archivo: no ocupan disco. Al pulsar «Descargar», el PDF se
 * arma en ese momento sobre la copia de la plantilla que se congeló al emitirlo.
 */
export const CERT_ONDEMAND_CYCLE_MS = 10_000;

export type CertOnDemandState = {
  stage: "idle" | "building" | "ready";
  /** Archivos guardados en disco para ese certificado (siempre 0) */
  filesOnDisk: number;
  /** Partes que se van estampando sobre la plantilla */
  reveal: { name: boolean; folio: boolean; qr: boolean };
};

export function certOnDemandStory(phase: number): CertOnDemandState {
  if (phase < 0.22) {
    return { stage: "idle", filesOnDisk: 0, reveal: { name: false, folio: false, qr: false } };
  }
  // Se arma: primero el nombre, luego el folio y el QR
  if (phase < 0.62) {
    return {
      stage: "building",
      filesOnDisk: 0,
      reveal: { name: phase >= 0.3, folio: phase >= 0.42, qr: phase >= 0.54 },
    };
  }
  return { stage: "ready", filesOnDisk: 0, reveal: { name: true, folio: true, qr: true } };
}
