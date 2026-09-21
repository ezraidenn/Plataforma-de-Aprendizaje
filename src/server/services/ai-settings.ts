import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { appSettings } from "@/server/db/schema";

/**
 * Configuración de la IA (OpenAI): la clave se guarda CIFRADA con AES-256-GCM
 * a partir de APP_SECRET, así una copia de la base no la revela sin el .env.
 * Sin clave, la función de IA no aparece en ningún lado.
 */

const KEY_SETTING = "openai_api_key";
const MODEL_SETTING = "openai_model";
export const DEFAULT_AI_MODEL = "gpt-5.6-terra";

/** Se puede apuntar a otro servidor compatible (o a un simulador en las pruebas). */
export const openaiBase = () => process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";

function cipherKey(): Buffer {
  const secret = process.env.APP_SECRET ?? "dev-secret";
  return createHash("sha256").update(`ai-key|${secret}`).digest();
}

/** AES-256-GCM: «iv.tag.datos» en base64url. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", cipherKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

/** null si no se puede leer (valor alterado o APP_SECRET distinto). */
export function decryptSecret(stored: string): string | null {
  try {
    const [iv, tag, data] = stored.split(".").map((p) => Buffer.from(p, "base64url"));
    if (!iv || !tag || !data) return null;
    const decipher = createDecipheriv("aes-256-gcm", cipherKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export const maskKey = (key: string) => `••••${key.slice(-4)}`;

function readSetting(key: string): string | null {
  return db.select().from(appSettings).where(eq(appSettings.key, key)).get()?.value ?? null;
}

function writeSetting(key: string, value: string | null) {
  db.insert(appSettings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } })
    .run();
}

export type AiSettings = {
  /** Hay clave guardada y se puede leer */
  configured: boolean;
  /** Hay clave guardada pero no se puede descifrar (cambió APP_SECRET) */
  unreadable: boolean;
  masked: string | null;
  model: string;
};

export function getAiSettings(): AiSettings {
  const stored = readSetting(KEY_SETTING);
  const key = stored ? decryptSecret(stored) : null;
  return {
    configured: !!key,
    unreadable: !!stored && !key,
    masked: key ? maskKey(key) : null,
    model: readSetting(MODEL_SETTING) || DEFAULT_AI_MODEL,
  };
}

/** La clave en claro, solo para llamar a la API. */
export function getAiKey(): string | null {
  const stored = readSetting(KEY_SETTING);
  return stored ? decryptSecret(stored) : null;
}

export function validateAiKey(raw: string): string {
  const key = raw.trim();
  if (!key.startsWith("sk-") || key.length < 20) {
    throw new Error("Esa no parece una clave de OpenAI (empieza con «sk-»)");
  }
  return key;
}

export function validateAiModel(raw: string): string {
  const model = raw.trim();
  if (!/^[a-z0-9][a-z0-9.\-]{1,60}$/i.test(model)) {
    throw new Error(`Escribe el nombre del modelo, por ejemplo ${DEFAULT_AI_MODEL}`);
  }
  return model;
}

/** Guarda el modelo y, si viene, una clave nueva (vacía = conservar la actual). */
export function saveAiSettings(input: { key?: string; model: string }) {
  const model = validateAiModel(input.model);
  if (input.key !== undefined && input.key.trim() !== "") {
    writeSetting(KEY_SETTING, encryptSecret(validateAiKey(input.key)));
  }
  writeSetting(MODEL_SETTING, model);
}

export function clearAiKey() {
  writeSetting(KEY_SETTING, null);
}

/** Traduce los errores de la API a mensajes para el administrador y el maestro. */
export function aiErrorMessage(status: number | null, body?: string): string {
  if (status === null) return "No hay conexión con OpenAI. Revisa que el servidor tenga internet.";
  if (status === 401) return "OpenAI rechazó la clave. Pide al administrador que la revise en Configuración.";
  if (status === 404) return "El modelo configurado no existe o tu cuenta no tiene acceso a él.";
  if (status === 429) {
    return body?.includes("insufficient_quota")
      ? "La cuenta de OpenAI no tiene saldo disponible."
      : "OpenAI está recibiendo demasiadas solicitudes. Intenta en un minuto.";
  }
  if (status >= 500) return "OpenAI no respondió bien. Intenta de nuevo en un momento.";
  return `OpenAI respondió con un error (${status}).`;
}

/** Prueba sin costo: que la clave y el modelo existan. */
export async function testAiConnection(
  key: string | null = getAiKey(),
  model: string = getAiSettings().model
): Promise<{ ok: true } | { error: string }> {
  if (!key) return { error: "Primero escribe o guarda una clave." };
  try {
    const res = await fetch(`${openaiBase()}/models/${encodeURIComponent(model)}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) return { ok: true };
    return { error: aiErrorMessage(res.status, await res.text().catch(() => "")) };
  } catch {
    return { error: aiErrorMessage(null) };
  }
}
