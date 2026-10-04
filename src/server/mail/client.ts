import "server-only";

/**
 * Cliente del servicio de correo de la red del club (orquestador). Solo del
 * lado del servidor: la clave vive en el .env (CORREO_API_URL, CORREO_API_KEY)
 * y nunca llega al navegador. El marco del correo (logo, colores y pie) lo pone
 * el servicio; aquí solo va el contenido.
 */

export type MailPayload = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Evita duplicados si se reintenta (el servicio la recuerda 24 h) */
  idempotencyKey?: string;
  /** Si no sale a tiempo, el servicio lo da por caducado */
  expiresInMinutes?: number;
};

/** Error del servicio, ya clasificado para decidir si se reintenta. */
export class MailError extends Error {
  constructor(
    message: string,
    /** "retry": volver a intentar más tarde · "wait": esperar `retryAfterSec` · "fatal": no reintentar */
    readonly action: "retry" | "wait" | "fatal",
    readonly status: number | null,
    readonly code: string | null,
    readonly retryAfterSec: number | null = null
  ) {
    super(message);
  }
}

export function mailConfigured(): boolean {
  return Boolean(process.env.CORREO_API_URL?.trim() && process.env.CORREO_API_KEY?.trim());
}

function base(): string {
  return (process.env.CORREO_API_URL ?? "").trim().replace(/\/+$/, "");
}

/** Para las pruebas: se puede cambiar el fetch (nunca llamar al servicio real). */
let fetchImpl: typeof fetch = (...args) => fetch(...args);
export function setMailFetch(impl: typeof fetch | null) {
  fetchImpl = impl ?? ((...args) => fetch(...args));
}

/** Manda un correo. Devuelve el id del servicio; si falla, lanza MailError. */
export async function sendMail(mail: MailPayload): Promise<{ id: string }> {
  if (!mailConfigured()) throw new MailError("El correo no está configurado en el servidor.", "fatal", null, "sin_configurar");
  let res: Response;
  try {
    res = await fetchImpl(`${base()}/v1/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${process.env.CORREO_API_KEY!.trim()}`,
      },
      body: JSON.stringify({
        to: mail.to,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        ...(mail.idempotencyKey ? { idempotencyKey: mail.idempotencyKey } : {}),
        ...(mail.expiresInMinutes ? { expiresInMinutes: mail.expiresInMinutes } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new MailError("El servicio de correo no respondió.", "retry", null, "sin_conexion");
  }

  const raw = await res.text();
  let body: { id?: string; error?: { code?: string; message?: string; details?: unknown } } = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    /* respuesta no JSON: se clasifica por el estado */
  }
  if (res.ok && body.id) return { id: body.id };

  const code = body.error?.code ?? null;
  const detail = body.error?.message ?? (raw.slice(0, 300) || `HTTP ${res.status}`);
  const message = `${code ?? `HTTP ${res.status}`}: ${detail}${body.error?.details ? ` ${JSON.stringify(body.error.details).slice(0, 500)}` : ""}`;
  // Ya se mandó antes con la misma llave: cuenta como enviado
  if (res.status === 409 && code === "idempotencia") {
    const original = (body.error?.details as { id?: string } | undefined)?.id;
    return { id: original ?? "duplicado" };
  }
  if (res.status === 429) {
    const after = Number(res.headers.get("retry-after"));
    throw new MailError(message, "wait", 429, code, Number.isFinite(after) && after > 0 ? after : 60);
  }
  if (res.status >= 500) throw new MailError(message, "retry", res.status, code);
  // 400 (datos, enlace no permitido), 401/403 (clave o permisos), 404, 413, 415: no se arregla reintentando
  throw new MailError(message, "fatal", res.status, code);
}
