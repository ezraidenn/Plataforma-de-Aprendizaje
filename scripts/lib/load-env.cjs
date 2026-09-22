/**
 * Carga .env igual que la app (src/server/db/index.ts). Los comandos de
 * mantenimiento no pasan por Next: sin esto ignoraban DATABASE_PATH,
 * STORAGE_PATH o BACKUP_DIR del .env (p. ej. `pnpm backup` respaldaba en
 * ./backups aunque el .env dijera otra carpeta).
 * loadEnvFile no pisa variables ya definidas.
 *
 * Uso: primera línea del script — require("./lib/load-env.cjs") en .cjs,
 * import "./lib/load-env.cjs" en .ts.
 */
const fs = require("node:fs");
const path = require("node:path");

const envFile = path.join(process.cwd(), ".env");
if (fs.existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile);
  } catch {
    /* un .env ilegible no debe tumbar el comando */
  }
}
