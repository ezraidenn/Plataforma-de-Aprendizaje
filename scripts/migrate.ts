import "./lib/load-env.cjs";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import fs from "node:fs";

const dbPath = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "data.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

migrate(drizzle(sqlite), { migrationsFolder: "./src/server/db/migrations" });

console.log("Migraciones aplicadas correctamente en", dbPath);
sqlite.close();
