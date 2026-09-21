/**
 * Graba en los certificados ya emitidos el alumno, el curso y el maestro que
 * muestran hoy, para que no cambien si se corrige el nombre del alumno, se
 * renombra el curso o se reasigna. Idempotente.
 *
 * Uso: pnpm certs:backfill
 */
import { backfillCertificateSnapshots } from "../src/server/services/certificates";

const n = backfillCertificateSnapshots();
console.log(`✅ ${n} dato(s) de certificados fijados`);
process.exit(0);
