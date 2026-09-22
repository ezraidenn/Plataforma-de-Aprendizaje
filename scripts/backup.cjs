/**
 * Respaldo de la plataforma: base de datos + archivos.
 *
 * - La base se copia con la API de backup de SQLite (segura con el servidor
 *   corriendo en modo WAL — no se corrompe ni bloquea).
 * - storage/ se copia de forma incremental (solo archivos nuevos/cambiados;
 *   los archivos subidos nunca se modifican, así que es rápido).
 * - Conserva los últimos BACKUP_KEEP respaldos de base de datos (default 14).
 *
 * Uso:  pnpm backup            → respalda a ./backups
 *       BACKUP_DIR=D:\respaldo pnpm backup
 *
 * Programar diario (Programador de tareas de Windows) — ver INSTALACION.md.
 */
require("./lib/load-env.cjs");
const Database = require("better-sqlite3");
const fs = require("node:fs");
const path = require("node:path");

const DB_PATH = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "data.db");

/**
 * Carpeta de archivos: la que el administrador dejó configurada en la propia
 * plataforma (puede ser el NAS), y si no, STORAGE_PATH o ./storage.
 */
function resolveStoragePath() {
  try {
    const probe = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    const row = probe.prepare("SELECT value FROM app_settings WHERE key = ?").get("storage_path");
    probe.close();
    if (row && row.value && row.value.trim()) return path.resolve(row.value.trim());
  } catch {
    // Base sin la tabla todavía, o en uso: usar la variable de entorno
  }
  return process.env.STORAGE_PATH
    ? path.resolve(process.env.STORAGE_PATH)
    : path.join(process.cwd(), "storage");
}

const STORAGE_PATH = resolveStoragePath();
const BACKUP_DIR = process.env.BACKUP_DIR ?? path.join(process.cwd(), "backups");
const KEEP = parseInt(process.env.BACKUP_KEEP ?? "14", 10);

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function copyIncremental(src, dest) {
  let copied = 0;
  let skipped = 0;
  const walk = (from, to) => {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      if (entry.name === "tmp") continue; // temporales de subida
      const srcFull = path.join(from, entry.name);
      const destFull = path.join(to, entry.name);
      if (entry.isDirectory()) {
        walk(srcFull, destFull);
        continue;
      }
      const srcStat = fs.statSync(srcFull);
      let needsCopy = true;
      try {
        const destStat = fs.statSync(destFull);
        needsCopy = destStat.size !== srcStat.size || destStat.mtimeMs < srcStat.mtimeMs;
      } catch {
        // no existe en destino
      }
      if (needsCopy) {
        fs.copyFileSync(srcFull, destFull);
        copied++;
      } else skipped++;
    }
  };
  if (fs.existsSync(src)) walk(src, dest);
  return { copied, skipped };
}

async function main() {
  console.log("=== Respaldo de la Plataforma de Capacitación ===");
  fs.mkdirSync(path.join(BACKUP_DIR, "db"), { recursive: true });

  // 1) Base de datos (API de backup en caliente)
  const dbDest = path.join(BACKUP_DIR, "db", `data-${timestamp()}.db`);
  const db = new Database(DB_PATH, { readonly: true });
  await db.backup(dbDest);
  db.close();
  const size = (fs.statSync(dbDest).size / 1024 / 1024).toFixed(1);
  console.log(`✓ Base de datos → ${dbDest} (${size} MB)`);

  // 2) Rotación: conservar los últimos KEEP
  const backups = fs
    .readdirSync(path.join(BACKUP_DIR, "db"))
    .filter((f) => f.startsWith("data-") && f.endsWith(".db"))
    .sort();
  for (const old of backups.slice(0, Math.max(0, backups.length - KEEP))) {
    fs.rmSync(path.join(BACKUP_DIR, "db", old));
    console.log(`  · rotado: ${old}`);
  }

  // 3) Archivos (incremental, espejo acumulativo)
  const { copied, skipped } = copyIncremental(STORAGE_PATH, path.join(BACKUP_DIR, "storage"));
  console.log(`✓ Archivos: ${copied} copiados, ${skipped} sin cambios`);

  console.log("=== Respaldo completado ===");
}

main().catch((err) => {
  console.error("ERROR en el respaldo:", err.message);
  process.exit(1);
});
