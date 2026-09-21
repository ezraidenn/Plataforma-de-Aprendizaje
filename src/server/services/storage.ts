import "server-only";
import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { nanoid } from "nanoid";
import { db } from "@/server/db";
import { appSettings, files } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { TOP, joinRelative, safeName, uniquePath } from "./storage-paths";

export type FileKind = (typeof files.$inferInsert)["kind"];

const SETTING_KEY = "storage_path";
const DEFAULT_ROOT = path.resolve(process.env.STORAGE_PATH ?? "./storage");

/** Caché en memoria: `storageRoot()` se llama en cada petición de archivo. */
let cachedRoot: string | null = null;

/**
 * Raíz del almacenamiento. Precedencia: ajuste en base de datos (Admin →
 * Configuración) → variable STORAGE_PATH → ./storage. Admite rutas UNC del NAS
 * (`\\SERVIDOR\Capacitacion`).
 */
export function storageRoot(): string {
  if (cachedRoot) return cachedRoot;
  let root = DEFAULT_ROOT;
  try {
    const saved = db.select().from(appSettings).where(eq(appSettings.key, SETTING_KEY)).get();
    if (saved?.value?.trim()) root = path.resolve(saved.value.trim());
  } catch {
    // La tabla puede no existir todavía (primera migración): usar el default
  }
  cachedRoot = root;
  return root;
}

/** Invalida la caché tras cambiar el ajuste (lo llama el servicio de admin). */
export function clearStorageRootCache(): void {
  cachedRoot = null;
}

export function absolutePathFor(storedPath: string): string {
  const root = storageRoot();
  const abs = path.resolve(root, storedPath);
  // Nunca servir nada fuera de la raíz (path traversal)
  if (!abs.startsWith(root + path.sep) && abs !== root) {
    throw new Error("Ruta de archivo inválida");
  }
  return abs;
}

/** ¿Existe ya ese archivo dentro de la raíz? (para resolver colisiones) */
function existsRelative(relPath: string): boolean {
  try {
    return fs.existsSync(absolutePathFor(relPath));
  } catch {
    return true; // Ruta inválida: tratarla como ocupada para no escribir ahí
  }
}

/**
 * Ruta de reserva cuando quien llama no propone una legible: conserva el
 * esquema anterior por tipo y año, con el nombre original saneado.
 */
function fallbackPath(kind: FileKind, originalName: string, id: string): string {
  const year = String(new Date().getFullYear());
  const ext = path.extname(originalName).toLowerCase();
  const base = safeName(path.basename(originalName, ext)) || id;
  return joinRelative(TOP.system, safeName(kind), year, `${base}${ext}`);
}

/**
 * Guarda un stream con hash sha256 calculado al vuelo (nunca se carga el
 * archivo completo en memoria) y registra la fila en `files`.
 *
 * `relPath` es la ruta legible sugerida dentro de la raíz (ver
 * `storage-paths.ts`); si se omite o colisiona, se ajusta automáticamente.
 */
export async function saveStream(opts: {
  stream: ReadableStream<Uint8Array> | Readable;
  originalName: string;
  mimeType: string;
  kind: FileKind;
  uploadedBy: string;
  /** Ruta legible relativa a la raíz. Si falta, se usa `_Sistema/<tipo>/<año>/`. */
  relPath?: string;
}): Promise<{ id: string; sizeBytes: number; sha256: string; relPath: string }> {
  const id = nanoid();
  const desired = opts.relPath?.trim() || fallbackPath(opts.kind, opts.originalName, id);
  const relPath = uniquePath(desired, existsRelative);

  const absPath = absolutePathFor(relPath);
  await fsp.mkdir(path.dirname(absPath), { recursive: true });

  const tmpPath = `${absPath}.${id}.tmp`;
  const nodeStream =
    opts.stream instanceof Readable ? opts.stream : Readable.fromWeb(opts.stream as never);

  const hasher = createHash("sha256");
  let sizeBytes = 0;
  nodeStream.on("data", (chunk: Buffer) => {
    hasher.update(chunk);
    sizeBytes += chunk.length;
  });

  try {
    // .tmp + rename: un corte de red o de luz nunca deja un archivo a medias
    await pipeline(nodeStream, fs.createWriteStream(tmpPath));
    await fsp.rename(tmpPath, absPath);
  } catch (err) {
    await fsp.rm(tmpPath, { force: true });
    throw err;
  }

  const sha256 = hasher.digest("hex");

  db.insert(files)
    .values({
      id,
      originalName: opts.originalName,
      storedPath: relPath,
      mimeType: opts.mimeType,
      sizeBytes,
      sha256,
      uploadedBy: opts.uploadedBy,
      kind: opts.kind,
    })
    .run();

  return { id, sizeBytes, sha256, relPath };
}

/** Registra un archivo ya escrito en disco (lo usa el worker de conversión). */
export function registerFile(opts: {
  id?: string;
  originalName: string;
  relPath: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  uploadedBy: string;
  kind: FileKind;
}): string {
  const id = opts.id ?? nanoid();
  db.insert(files)
    .values({
      id,
      originalName: opts.originalName,
      storedPath: opts.relPath,
      mimeType: opts.mimeType,
      sizeBytes: opts.sizeBytes,
      sha256: opts.sha256,
      uploadedBy: opts.uploadedBy,
      kind: opts.kind,
    })
    .run();
  return id;
}

export function getFileRecord(fileId: string) {
  return db.select().from(files).where(eq(files.id, fileId)).get() ?? null;
}

/**
 * Mueve un archivo a una ruta legible nueva (renombrar curso, módulo o
 * lección). Primero mueve en disco y después actualiza la fila; si la
 * actualización falla, deshace el movimiento para no dejar inconsistencias.
 */
export async function moveFile(fileId: string, desiredRelPath: string): Promise<string | null> {
  const rec = getFileRecord(fileId);
  if (!rec) return null;
  if (rec.storedPath === desiredRelPath) return rec.storedPath;

  const from = absolutePathFor(rec.storedPath);
  if (!fs.existsSync(from)) return null; // Lo reporta `storage:check`

  const relPath = uniquePath(desiredRelPath, existsRelative);
  const to = absolutePathFor(relPath);
  await fsp.mkdir(path.dirname(to), { recursive: true });

  try {
    await fsp.rename(from, to);
  } catch (err) {
    // Distinto volumen (NAS ↔ local): copiar y borrar
    if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
    await fsp.copyFile(from, to);
    await fsp.rm(from, { force: true });
  }

  try {
    db.update(files).set({ storedPath: relPath }).where(eq(files.id, fileId)).run();
  } catch (err) {
    await fsp.rename(to, from).catch(() => {});
    throw err;
  }

  await pruneEmptyDirs(path.dirname(from));
  return relPath;
}

/** Borra carpetas vacías hacia arriba, sin salir nunca de la raíz. */
export async function pruneEmptyDirs(startDir: string): Promise<void> {
  const root = storageRoot();
  let dir = startDir;
  while (dir.startsWith(root + path.sep)) {
    try {
      const entries = await fsp.readdir(dir);
      if (entries.length > 0) return;
      await fsp.rmdir(dir);
    } catch {
      return;
    }
    dir = path.dirname(dir);
  }
}

export async function deleteFile(fileId: string) {
  const rec = getFileRecord(fileId);
  if (!rec) return;
  const abs = absolutePathFor(rec.storedPath);
  await fsp.rm(abs, { force: true });
  db.delete(files).where(eq(files.id, fileId)).run();
  await pruneEmptyDirs(path.dirname(abs));
}

// ─── Configuración de la raíz (Admin → Configuración) ───────────────────────

export type StorageRootCheck = { ok: true; warning?: string } | { ok: false; error: string };

/**
 * Verifica que una ruta sirva como raíz: existe (o se puede crear) y admite
 * escritura real. Se ejecuta ANTES de guardar el ajuste.
 */
export async function checkStorageRoot(rawPath: string): Promise<StorageRootCheck> {
  const target = rawPath.trim();
  if (!target) return { ok: false, error: "Escribe una ruta" };
  if (!path.isAbsolute(target)) {
    return { ok: false, error: "Usa una ruta absoluta (C:\\Datos\\Capacitacion o \\\\NAS\\Recurso)" };
  }

  const root = path.resolve(target);
  try {
    await fsp.mkdir(root, { recursive: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EACCES") {
      return { ok: false, error: "Sin permisos para crear o escribir en esa carpeta" };
    }
    return { ok: false, error: "No se pudo acceder a la carpeta: " + (err as Error).message };
  }

  // Escritura real: crear, leer y borrar
  const probe = path.join(root, `.lms-write-test-${nanoid(6)}`);
  try {
    await fsp.writeFile(probe, "ok", "utf8");
    const back = await fsp.readFile(probe, "utf8");
    await fsp.rm(probe, { force: true });
    if (back !== "ok") return { ok: false, error: "La carpeta no devuelve lo que se escribe" };
  } catch (err) {
    await fsp.rm(probe, { force: true }).catch(() => {});
    return { ok: false, error: "La carpeta no admite escritura: " + (err as Error).message };
  }

  let warning: string | undefined;
  try {
    const entries = await fsp.readdir(root);
    const known = new Set<string>([TOP.courses, TOP.submissions, TOP.system, TOP.trash]);
    const foreign = entries.filter((e) => !known.has(e) && !e.startsWith("."));
    if (foreign.length > 0) {
      warning = `La carpeta ya contiene ${foreign.length} elemento(s) ajenos a la plataforma. Se usará de todas formas.`;
    }
  } catch {
    /* si no se puede listar, no es motivo para rechazarla */
  }

  return { ok: true, warning };
}

/** Guarda la raíz nueva (no mueve archivos: eso lo hace `storage:move`). */
export function setStorageRootSetting(rawPath: string): void {
  const value = path.resolve(rawPath.trim());
  const existing = db.select().from(appSettings).where(eq(appSettings.key, SETTING_KEY)).get();
  if (existing) {
    db.update(appSettings)
      .set({ value, updatedAt: new Date() })
      .where(eq(appSettings.key, SETTING_KEY))
      .run();
  } else {
    db.insert(appSettings).values({ key: SETTING_KEY, value }).run();
  }
  clearStorageRootCache();
}

/** Datos para la tarjeta de Almacenamiento en Admin → Configuración. */
export function storageRootInfo(): {
  root: string;
  source: "ajuste" | "variable de entorno" | "predeterminada";
  isUnc: boolean;
} {
  const saved = db.select().from(appSettings).where(eq(appSettings.key, SETTING_KEY)).get();
  const root = storageRoot();
  const source = saved?.value?.trim()
    ? "ajuste"
    : process.env.STORAGE_PATH
      ? "variable de entorno"
      : "predeterminada";
  return { root, source, isUnc: root.startsWith("\\\\") };
}
