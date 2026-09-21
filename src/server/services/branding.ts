import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { appSettings } from "@/server/db/schema";
import { enqueueJob } from "@/server/jobs/queue";
import { getFileRecord } from "./storage";
import { audit } from "./audit";
import { getCoverPreset, coverDataUrl } from "@/lib/cover-presets";

const KEY_PLATFORM_NAME = "platform_name";
const KEY_LOGO_FILE_ID = "logo_file_id";
const KEY_COVER_ENABLED = "cover_enabled";
const KEY_COVER_KIND = "cover_kind";
const KEY_COVER_PRESET = "cover_preset";
const KEY_COVER_FILE_ID = "cover_file_id";
const KEY_COVER_PLACEMENT = "cover_placement";
const DEFAULT_COVER_PRESET = "aurora";

export const DEFAULT_PLATFORM_NAME = "Plataforma de Capacitación";

export function getSetting(key: string): string | null {
  return db.select().from(appSettings).where(eq(appSettings.key, key)).get()?.value ?? null;
}

export function setSetting(key: string, value: string | null) {
  const existing = db.select().from(appSettings).where(eq(appSettings.key, key)).get();
  if (existing) {
    db.update(appSettings)
      .set({ value, updatedAt: new Date() })
      .where(eq(appSettings.key, key))
      .run();
  } else {
    db.insert(appSettings).values({ key, value }).run();
  }
}

export type CoverKind = "preset" | "photo";
export type CoverPlacement = "login" | "dashboard" | "both";

export type Branding = {
  platformName: string;
  /** null = usar el icono por defecto */
  logoFileId: string | null;
  /** Portada (login / dashboard). Desactivada por defecto. */
  cover: {
    enabled: boolean;
    kind: CoverKind;
    presetId: string;
    fileId: string | null;
    placement: CoverPlacement;
  };
};

/** Identidad de la empresa: nombre + logo + portada. Se consulta en cada shell (barato). */
export function getBranding(): Branding {
  const logoFileId = getSetting(KEY_LOGO_FILE_ID);
  // Defensivo: si el archivo del logo fue borrado, volver al default
  const validLogo = logoFileId && getFileRecord(logoFileId) ? logoFileId : null;
  const coverFileId = getSetting(KEY_COVER_FILE_ID);
  const validCover = coverFileId && getFileRecord(coverFileId) ? coverFileId : null;
  const kind = getSetting(KEY_COVER_KIND);
  const placement = getSetting(KEY_COVER_PLACEMENT);
  return {
    platformName: getSetting(KEY_PLATFORM_NAME)?.trim() || DEFAULT_PLATFORM_NAME,
    logoFileId: validLogo,
    cover: {
      enabled: getSetting(KEY_COVER_ENABLED) === "1",
      kind: kind === "photo" ? "photo" : "preset",
      presetId: getCoverPreset(getSetting(KEY_COVER_PRESET))?.id ?? DEFAULT_COVER_PRESET,
      fileId: validCover,
      placement: placement === "login" || placement === "dashboard" ? placement : "both",
    },
  };
}

/**
 * URL de la portada activa para un lugar dado, o null si está desactivada o no
 * aplica ahí. Lista para `background-image: url(...)`.
 */
export function coverImageFor(branding: Branding, place: "login" | "dashboard"): string | null {
  const c = branding.cover;
  if (!c.enabled) return null;
  if (c.placement !== "both" && c.placement !== place) return null;
  if (c.kind === "photo") return c.fileId ? `/api/files/${c.fileId}` : null;
  const preset = getCoverPreset(c.presetId);
  return preset ? coverDataUrl(preset.svg) : null;
}

const IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

export function updateBranding(opts: {
  actorId: string;
  platformName?: string;
  /** undefined = no tocar · null = quitar logo · string = nuevo fileId */
  logoFileId?: string | null;
  cover?: {
    enabled?: boolean;
    kind?: CoverKind;
    presetId?: string;
    /** undefined = no tocar · null = quitar foto */
    fileId?: string | null;
    placement?: CoverPlacement;
  };
}) {
  if (opts.platformName !== undefined) {
    const name = opts.platformName.trim();
    if (name.length < 2 || name.length > 60) {
      throw new Error("El nombre debe tener entre 2 y 60 caracteres");
    }
    setSetting(KEY_PLATFORM_NAME, name);
  }

  if (opts.logoFileId !== undefined) {
    if (opts.logoFileId === null) {
      setSetting(KEY_LOGO_FILE_ID, null);
    } else {
      const record = getFileRecord(opts.logoFileId);
      if (!record || record.kind !== "branding") {
        throw new Error("Sube primero la imagen del logo");
      }
      // PNG/JPG/WEBP solamente (nunca SVG: puede ejecutar scripts al servirse)
      if (!IMAGE_MIME.has(record.mimeType)) {
        throw new Error("El logo debe ser PNG, JPG o WEBP");
      }
      if (record.sizeBytes > 2 * 1024 * 1024) {
        throw new Error("El logo no debe pesar más de 2 MB");
      }
      setSetting(KEY_LOGO_FILE_ID, opts.logoFileId);
      // Del destino genérico de la subida a _Sistema/Identidad (como la portada del curso)
      enqueueJob("relocate_files", { fileId: opts.logoFileId });
    }
  }

  if (opts.cover) {
    const c = opts.cover;
    if (c.enabled !== undefined) setSetting(KEY_COVER_ENABLED, c.enabled ? "1" : "0");
    if (c.kind !== undefined) {
      if (c.kind !== "preset" && c.kind !== "photo") throw new Error("Tipo de portada inválido");
      setSetting(KEY_COVER_KIND, c.kind);
    }
    if (c.presetId !== undefined) {
      if (!getCoverPreset(c.presetId)) throw new Error("Portada vectorial no encontrada");
      setSetting(KEY_COVER_PRESET, c.presetId);
    }
    if (c.placement !== undefined) {
      if (!["login", "dashboard", "both"].includes(c.placement)) throw new Error("Ubicación inválida");
      setSetting(KEY_COVER_PLACEMENT, c.placement);
    }
    if (c.fileId !== undefined) {
      if (c.fileId === null) {
        setSetting(KEY_COVER_FILE_ID, null);
      } else {
        const record = getFileRecord(c.fileId);
        if (!record || record.kind !== "branding") throw new Error("Sube primero la foto de portada");
        if (!IMAGE_MIME.has(record.mimeType)) throw new Error("La portada debe ser PNG, JPG o WEBP");
        if (record.sizeBytes > 6 * 1024 * 1024) throw new Error("La portada no debe pesar más de 6 MB");
        setSetting(KEY_COVER_FILE_ID, c.fileId);
        enqueueJob("relocate_files", { fileId: c.fileId });
      }
    }
  }

  audit(opts.actorId, "update_branding", "app_settings", undefined, {
    platformName: opts.platformName,
    logoChanged: opts.logoFileId !== undefined,
    coverChanged: opts.cover !== undefined,
  });
}
