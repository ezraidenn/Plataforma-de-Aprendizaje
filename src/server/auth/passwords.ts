import { hash, verify } from "@node-rs/argon2";

// Parámetros argon2id recomendados por OWASP (equilibrio para servidor local)
const ARGON2_OPTS = {
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password, ARGON2_OPTS);
  } catch {
    return false;
  }
}

export function generateTempPassword(): string {
  // Legible para dictar en persona: sin caracteres ambiguos (0/O, 1/l/I)
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  for (const b of bytes) out += chars[b % chars.length];
  return out;
}
