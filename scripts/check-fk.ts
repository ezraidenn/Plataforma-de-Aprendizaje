/**
 * Verifica que las claves foráneas de la base (PRAGMA foreign_key_list)
 * coincidan con las declaradas en schema.ts, incluida la acción ON DELETE.
 * Existe porque drizzle-kit, en SQLite, escribe `ALTER TABLE … ADD … REFERENCES`
 * sin la acción: la base queda NO ACTION aunque el esquema diga cascade/set null.
 *
 * Uso: pnpm db:check            (base de data/)
 *      DATABASE_PATH=otra.db pnpm db:check
 */
import path from "node:path";
import Database from "better-sqlite3";
import { is } from "drizzle-orm";
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import * as schema from "../src/server/db/schema";

const dbPath = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "data.db");
const db = new Database(dbPath, { readonly: true });

type Fk = { from: string; table: string; to: string; onDelete: string };
const norm = (action: string | undefined) => (action ?? "no action").toUpperCase();

let problems = 0;
let checked = 0;
for (const value of Object.values(schema)) {
  if (!is(value, SQLiteTable)) continue;
  const config = getTableConfig(value);
  const actual = (db.prepare(`PRAGMA foreign_key_list("${config.name}")`).all() as {
    from: string;
    table: string;
    to: string;
    on_delete: string;
  }[]).map((r): Fk => ({ from: r.from, table: r.table, to: r.to, onDelete: r.on_delete.toUpperCase() }));

  for (const fk of config.foreignKeys) {
    const ref = fk.reference();
    const from = ref.columns[0].name;
    const target = getTableConfig(ref.foreignTable).name;
    const expected = norm(fk.onDelete);
    const found = actual.find((a) => a.from === from && a.table === target);
    checked++;
    if (!found) {
      problems++;
      console.log(`✗ ${config.name}.${from} → ${target}: la clave no existe en la base`);
    } else if (found.onDelete !== expected) {
      problems++;
      console.log(`✗ ${config.name}.${from} → ${target}: ON DELETE ${found.onDelete} (el esquema dice ${expected})`);
    }
  }
}

const fkViolations = db.prepare("PRAGMA foreign_key_check").all();
const integrity = (db.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
console.log(`\n${checked} claves foráneas revisadas en ${dbPath}`);
console.log(`integrity_check: ${integrity} · filas huérfanas: ${fkViolations.length}`);
if (problems || fkViolations.length || integrity !== "ok") {
  console.log(`\n❌ ${problems} diferencia(s) con el esquema`);
  process.exit(1);
}
console.log("✅ La base coincide con el esquema");
