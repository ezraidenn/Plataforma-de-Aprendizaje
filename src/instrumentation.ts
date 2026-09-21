/**
 * Arranca el worker de jobs junto con el servidor Next (una vez por proceso).
 * Solo en runtime Node (no Edge, no build).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startWorker } = await import("@/server/jobs/worker");
    startWorker();

    // Certificados emitidos antes de congelar alumno, curso y maestro: se completan una vez (idempotente)
    const { backfillCertificateSnapshots } = await import("@/server/services/certificates");
    try {
      const n = backfillCertificateSnapshots();
      if (n > 0) console.log(`[certificados] ${n} con nombres fijados`);
    } catch (err) {
      console.error("[certificados] no se pudieron fijar los nombres:", err);
    }
  }
}
