/**
 * Reconstrucción completa de la base de datos (mantenimiento, SERVIDOR APAGADO).
 *
 *   node scripts/db-rebuild.cjs          → todo:
 *     1. respaldo binario de data.db en backups/db/
 *     2. «semilla»: volcado SQL de TODOS los datos en backups/seed/seed-<fecha>.sql
 *     3. base nueva desde cero con TODAS las migraciones (idéntica a una instalación nueva)
 *     4. carga de la semilla en la base nueva
 *     5. verificación: filas por tabla, integrity_check y foreign_key_check
 *     6. intercambio: data.db ← base nueva (la anterior queda respaldada)
 *   node scripts/db-rebuild.cjs dump     → solo la semilla (paso 2)
 *   node scripts/db-rebuild.cjs load <semilla.sql> [--db <ruta>]
 *        → crea una base nueva con las migraciones y carga ahí la semilla
 *          (p. ej. para llevar estos datos a otro servidor). No toca data.db
 *          salvo que --db apunte a él, y se niega si el archivo ya existe.
 *
 * Los archivos (storage/) no se tocan: la tabla `files` se copia tal cual.
 */
require("./lib/load-env.cjs");
const Database = require("better-sqlite3");
const fs = require("node:fs");
const path = require("node:path");
const { drizzle } = require("drizzle-orm/better-sqlite3");
const { migrate } = require("drizzle-orm/better-sqlite3/migrator");

const ROOT = process.cwd();
const DB_PATH = process.env.DATABASE_PATH ?? path.join(ROOT, "data", "data.db");
const MIGRATIONS = path.join(ROOT, "src", "server", "db", "migrations");
const BACKUP_DIR = path.join(ROOT, "backups", "db");
const SEED_DIR = path.join(ROOT, "backups", "seed");

const pad = (n) => String(n).padStart(2, "0");
const now = new Date();
const STAMP = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;

function fail(msg) {
  console.error(`\n❌ ${msg}`);
  process.exit(1);
}

/** Tablas de datos (sin las internas de SQLite ni el registro de migraciones). */
function dataTables(db) {
  return db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations' ORDER BY name"
    )
    .all()
    .map((r) => r.name);
}

function sqlValue(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (Buffer.isBuffer(v)) return `X'${v.toString("hex")}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** Volcado de datos como INSERT con nombres de columna (el orden físico no importa). */
function dumpSeed(db, file) {
  const lines = [
    `-- Semilla de datos de la Plataforma de aprendizaje (${STAMP})`,
    "-- Solo datos: el esquema lo crean las migraciones. Cargar con:",
    "--   node scripts/db-rebuild.cjs load <este archivo> --db <base nueva>",
  ];
  const counts = {};
  for (const table of dataTables(db)) {
    const stmt = db.prepare(`SELECT * FROM "${table}"`);
    const cols = stmt.columns().map((c) => `"${c.name}"`).join(", ");
    const rows = stmt.raw().all();
    counts[table] = rows.length;
    if (rows.length === 0) continue;
    lines.push(`\n-- ${table}: ${rows.length}`);
    for (const row of rows) lines.push(`INSERT INTO "${table}" (${cols}) VALUES (${row.map(sqlValue).join(", ")});`);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join("\n") + "\n", "utf8");
  return counts;
}

/** Base nueva con todas las migraciones. */
function freshDatabase(file) {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(drizzle(db), { migrationsFolder: MIGRATIONS });
  return db;
}

/** Carga la semilla en una transacción, con las FK apagadas durante la carga. */
function loadSeed(db, sqlText) {
  db.pragma("foreign_keys = OFF");
  db.exec("BEGIN");
  try {
    // Una base recién migrada no trae filas, pero por si acaso se vacía antes
    for (const table of dataTables(db)) db.exec(`DELETE FROM "${table}"`);
    db.exec(sqlText);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

function verify(db, expected) {
  const problems = [];
  for (const [table, n] of Object.entries(expected)) {
    const got = db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n;
    if (got !== n) problems.push(`${table}: ${got} filas (esperaba ${n})`);
  }
  const integrity = db.prepare("PRAGMA integrity_check").get().integrity_check;
  if (integrity !== "ok") problems.push(`integrity_check: ${integrity}`);
  const orphans = db.prepare("PRAGMA foreign_key_check").all();
  if (orphans.length) problems.push(`${orphans.length} filas con claves foráneas rotas`);
  return problems;
}

function removeSidecars(file) {
  for (const ext of ["-wal", "-shm"]) if (fs.existsSync(file + ext)) fs.rmSync(file + ext);
}

/** Abre la base actual y comprueba que nadie más la esté usando. */
function openExclusive(file) {
  if (!fs.existsSync(file)) fail(`No existe ${file}`);
  const db = new Database(file, { timeout: 2000 });
  const cp = db.pragma("wal_checkpoint(TRUNCATE)", { simple: false })[0];
  try {
    db.exec("BEGIN EXCLUSIVE");
    db.exec("ROLLBACK");
  } catch {
    db.close();
    fail("La base está en uso: apaga el servidor (nssm stop / cierra next start) y vuelve a intentarlo.");
  }
  if (cp && cp.busy) {
    db.close();
    fail("La base está en uso (checkpoint ocupado): apaga el servidor y vuelve a intentarlo.");
  }
  return db;
}

// ─── Comandos ────────────────────────────────────────────────────────────────

const [cmd, arg] = process.argv.slice(2);

if (cmd === "dump") {
  const db = openExclusive(DB_PATH);
  const file = path.join(SEED_DIR, `seed-${STAMP}.sql`);
  const counts = dumpSeed(db, file);
  db.close();
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`✓ Semilla: ${file} (${total} filas en ${Object.keys(counts).length} tablas)`);
  process.exit(0);
}

if (cmd === "load") {
  if (!arg || !fs.existsSync(arg)) fail("Indica la semilla: node scripts/db-rebuild.cjs load <semilla.sql> [--db <ruta>]");
  const dbFlag = process.argv.indexOf("--db");
  const target = dbFlag > 0 ? path.resolve(process.argv[dbFlag + 1]) : DB_PATH;
  if (fs.existsSync(target)) fail(`${target} ya existe: la carga es solo para bases nuevas (bórrala o usa --db con otra ruta).`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const db = freshDatabase(target);
  loadSeed(db, fs.readFileSync(arg, "utf8"));
  const problems = verify(db, {});
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.close();
  if (problems.length) fail(problems.join("\n"));
  console.log(`✓ Base nueva con la semilla: ${target}`);
  process.exit(0);
}

if (cmd) fail(`Comando desconocido: ${cmd}`);

// Reconstrucción completa
console.log("=== Reconstrucción completa de la base ===");
const current = openExclusive(DB_PATH);

// 1) Respaldo binario
fs.mkdirSync(BACKUP_DIR, { recursive: true });
const backupFile = path.join(BACKUP_DIR, `data-${STAMP}-antes-de-reconstruir.db`);
current.exec(`VACUUM INTO '${backupFile.replace(/'/g, "''")}'`);
console.log(`1. Respaldo  → ${backupFile}`);

// 2) Semilla
const seedFile = path.join(SEED_DIR, `seed-${STAMP}.sql`);
const counts = dumpSeed(current, seedFile);
const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(`2. Semilla   → ${seedFile} (${total} filas, ${Object.keys(counts).length} tablas)`);
current.close();

// 3) Base nueva desde cero
const newPath = DB_PATH.replace(/\.db$/, "") + `.rebuild-${STAMP}.db`;
if (fs.existsSync(newPath)) fs.rmSync(newPath);
removeSidecars(newPath);
const fresh = freshDatabase(newPath);
console.log("3. Base nueva con todas las migraciones");

// 4) Carga
loadSeed(fresh, fs.readFileSync(seedFile, "utf8"));
console.log("4. Semilla cargada");

// 5) Verificación
const problems = verify(fresh, counts);
fresh.pragma("wal_checkpoint(TRUNCATE)");
fresh.close();
if (problems.length) {
  fs.rmSync(newPath, { force: true });
  removeSidecars(newPath);
  fail(`La verificación falló; la base actual NO se tocó:\n${problems.join("\n")}`);
}
console.log("5. Verificación: filas idénticas, integridad ok, sin claves rotas");

// 6) Intercambio: la anterior se aparta primero y vuelve si algo falla
const oldTemp = `${DB_PATH}.anterior-${STAMP}`;
removeSidecars(DB_PATH);
removeSidecars(newPath);
fs.renameSync(DB_PATH, oldTemp);
try {
  fs.renameSync(newPath, DB_PATH);
} catch (err) {
  fs.renameSync(oldTemp, DB_PATH);
  fail(`No se pudo colocar la base nueva (${err.message}); se dejó la anterior.`);
}
fs.rmSync(oldTemp); // ya está respaldada en el paso 1
console.log(`6. Intercambio: ${DB_PATH} es la base reconstruida`);
console.log("\n✅ Listo. Inicia el servidor y corre `pnpm db:check`.");
