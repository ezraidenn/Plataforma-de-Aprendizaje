/**
 * Seed inicial: crea un admin, un maestro y un estudiante de prueba.
 * Idempotente: si el email ya existe, lo omite.
 *
 * Uso: pnpm db:seed
 */
import Database from "better-sqlite3";
import path from "node:path";
import { hash } from "@node-rs/argon2";
import { nanoid } from "nanoid";

const dbPath = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "data.db");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const ARGON2_OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

const USERS = [
  {
    email: "admin@empresa.local",
    fullName: "Administrador General",
    role: "admin",
    password: "admin1234",
  },
  {
    email: "maestro@empresa.local",
    fullName: "Prof. Roberto Martínez",
    role: "teacher",
    password: "maestro1234",
  },
  {
    email: "estudiante@empresa.local",
    fullName: "Laura Pérez",
    role: "student",
    password: "estudiante1234",
  },
] as const;

async function main() {
  const exists = db.prepare("SELECT id FROM users WHERE email = ?");
  const insert = db.prepare(
    `INSERT INTO users (id, email, password_hash, full_name, role, active)
     VALUES (?, ?, ?, ?, ?, 1)`
  );

  for (const u of USERS) {
    if (exists.get(u.email)) {
      console.log(`— ${u.email} ya existe, omitido`);
      continue;
    }
    const passwordHash = await hash(u.password, ARGON2_OPTS);
    insert.run(nanoid(), u.email, passwordHash, u.fullName, u.role);
    console.log(`✓ ${u.role}: ${u.email} / ${u.password}`);
  }

  console.log("\nSeed completado. Estas credenciales son SOLO para desarrollo.");
  db.close();
}

main();
