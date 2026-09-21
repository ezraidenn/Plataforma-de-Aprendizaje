import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import * as schema from "./schema";

// Los scripts (smokes, seeds, rellenos) no pasan por Next, que es quien carga
// .env: sin esto usaban otro APP_SECRET y firmaban certificados distintos.
// loadEnvFile no pisa variables ya definidas.
const envFile = path.join(process.cwd(), ".env");
if (fs.existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile);
  } catch {
    /* un .env ilegible no debe tumbar la conexión */
  }
}

const dbPath =process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "data.db");

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

// Singleton: en dev, Next recarga módulos; evitamos abrir N conexiones
const globalForDb = globalThis as unknown as { __sqlite?: Database.Database };

const sqlite =
  globalForDb.__sqlite ??
  (() => {
    const conn = new Database(dbPath);
    conn.pragma("journal_mode = WAL");
    conn.pragma("busy_timeout = 5000");
    conn.pragma("foreign_keys = ON");
    // Búsqueda sin acentos (ver src/server/db/search.ts)
    conn.function("unaccent", { deterministic: true }, (v: unknown) =>
      typeof v === "string" ? v.normalize("NFD").replace(/[̀-ͯ]/g, "") : v
    );
    return conn;
  })();

if (process.env.NODE_ENV !== "production") globalForDb.__sqlite = sqlite;

export const db = drizzle(sqlite, { schema });
export { schema };
