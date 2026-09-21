/**
 * Herramienta de almacenamiento. Con el servidor detenido o en marcha:
 *
 *   pnpm storage plan                 Qué se movería (no toca nada)
 *   pnpm storage apply                Reorganiza en carpetas legibles
 *   pnpm storage apply --purge-certs  …y elimina los PDF de certificados
 *   pnpm storage apply --purge-orphans …y borra lo que nada referencia
 *   pnpm storage check                Integridad: rotos, huérfanos, desviados
 *   pnpm storage where                Raíz actual y de dónde sale
 *   pnpm storage move --to "<ruta>"   Copia todo a otra raíz y la deja activa
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { db } from "@/server/db";
import { certificates, files } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import {
  absolutePathFor,
  checkStorageRoot,
  getFileRecord,
  moveFile,
  pruneEmptyDirs,
  setStorageRootSetting,
  storageRoot,
  storageRootInfo,
} from "@/server/services/storage";
import { desiredPathForFile, isReferenced } from "@/server/services/storage-layout";
import { TOP } from "@/server/services/storage-paths";

const args = process.argv.slice(2);
const command = args[0] ?? "plan";
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;

function allFiles() {
  return db.select().from(files).all();
}

/** Movimientos pendientes: archivos que no están donde les toca. */
function plan() {
  const moves: { id: string; from: string; to: string; name: string }[] = [];
  const orphans: { id: string; path: string; kind: string; sizeBytes: number }[] = [];
  for (const f of allFiles()) {
    const desired = desiredPathForFile(f.id);
    if (desired) {
      if (desired !== f.storedPath) {
        moves.push({ id: f.id, from: f.storedPath, to: desired, name: f.originalName });
      }
    } else if (!isReferenced(f.id)) {
      // Nada lo referencia: sobra (típicamente de cursos de prueba borrados)
      orphans.push({ id: f.id, path: f.storedPath, kind: f.kind, sizeBytes: f.sizeBytes });
    }
  }
  return { moves, orphans };
}

async function cmdPlan() {
  const { moves, orphans } = plan();
  console.log(`Raíz: ${storageRoot()}\n`);
  if (moves.length === 0) {
    console.log("✓ Todos los archivos ya están en su carpeta legible.");
  } else {
    console.log(`${moves.length} archivo(s) por reorganizar:\n`);
    for (const m of moves.slice(0, 40)) {
      console.log(`  ${m.from}`);
      console.log(`  → ${m.to}\n`);
    }
    if (moves.length > 40) console.log(`  … y ${moves.length - 40} más\n`);
  }
  if (orphans.length > 0) {
    const bytes = orphans.reduce((s, o) => s + o.sizeBytes, 0);
    console.log(
      `
${orphans.length} archivo(s) que nada referencia (${kb(bytes)}), ` +
        "normalmente de cursos de prueba borrados:"
    );
    for (const u of orphans.slice(0, 8)) console.log(`  [${u.kind}] ${u.path}`);
    if (orphans.length > 8) console.log(`  … y ${orphans.length - 8} más`);
    console.log("  Elimínalos con «apply --purge-orphans».");
  }
  const certs = db.select().from(certificates).all().filter((c) => c.pdfFileId);
  if (certs.length > 0) {
    const bytes = certs.reduce((s, c) => s + (getFileRecord(c.pdfFileId!)?.sizeBytes ?? 0), 0);
    console.log(
      `\n${certs.length} certificado(s) con PDF en disco (${kb(bytes)}). ` +
        `Se generan al descargar: usa «apply --purge-certs» para liberarlos.`
    );
  }
  console.log("\nSimulacro: no se movió nada. Ejecuta «apply» para aplicarlo.");
}

async function cmdApply() {
  const { moves, orphans } = plan();
  const purge = flag("purge-certs");
  const purgeOrphans = flag("purge-orphans");
  console.log(`Raíz: ${storageRoot()}`);
  console.log(`Reorganizando ${moves.length} archivo(s)…\n`);

  let moved = 0;
  let failed = 0;
  for (const m of moves) {
    try {
      const result = await moveFile(m.id, m.to);
      if (result) {
        moved++;
        if (moved % 25 === 0) console.log(`  ${moved}/${moves.length}…`);
      } else {
        failed++;
        console.log(`  ⚠ sin archivo en disco: ${m.from}`);
      }
    } catch (err) {
      failed++;
      console.log(`  ✗ ${m.from}: ${(err as Error).message}`);
    }
  }
  console.log(`\n✓ ${moved} movido(s)${failed ? `, ${failed} con problemas` : ""}`);

  if (purge) {
    const certs = db.select().from(certificates).all().filter((c) => c.pdfFileId);
    let removed = 0;
    let freed = 0;
    for (const cert of certs) {
      const rec = getFileRecord(cert.pdfFileId!);
      // Desvincular ANTES de borrar la fila: pdf_file_id es clave foránea
      db.update(certificates).set({ pdfFileId: null }).where(eq(certificates.id, cert.id)).run();
      if (rec) {
        try {
          const abs = absolutePathFor(rec.storedPath);
          if (fs.existsSync(abs)) {
            freed += rec.sizeBytes;
            await fsp.rm(abs, { force: true });
            await pruneEmptyDirs(path.dirname(abs));
          }
          db.delete(files).where(eq(files.id, rec.id)).run();
        } catch (err) {
          console.log(`  ⚠ ${cert.folio}: ${(err as Error).message}`);
        }
      }
      removed++;
    }
    console.log(`✓ ${removed} certificado(s) ahora se generan al descargar (${kb(freed)} liberados)`);
  }

  if (purgeOrphans && orphans.length > 0) {
    let removed = 0;
    let freed = 0;
    for (const o of orphans) {
      try {
        const abs = absolutePathFor(o.path);
        if (fs.existsSync(abs)) {
          freed += o.sizeBytes;
          await fsp.rm(abs, { force: true });
          await pruneEmptyDirs(path.dirname(abs));
        }
        db.delete(files).where(eq(files.id, o.id)).run();
        removed++;
      } catch (err) {
        console.log(`  ⚠ ${o.path}: ${(err as Error).message}`);
      }
    }
    console.log(`✓ ${removed} archivo(s) sin dueño eliminados (${kb(freed)} liberados)`);
  }

  // Limpiar las carpetas del esquema anterior si quedaron vacías
  const root = storageRoot();
  for (const legacy of [
    "course_source", "course_render", "submission", "certificate",
    "template_bg", "cover", "branding", "resource", "attachment",
    "editor_image", "thumbnail", "tmp",
  ]) {
    const dir = path.join(root, legacy);
    if (fs.existsSync(dir)) {
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
  console.log("✓ Carpetas del esquema anterior eliminadas si quedaron vacías");
}

async function cmdCheck() {
  const root = storageRoot();
  console.log(`Raíz: ${root}\n`);

  const rows = allFiles();
  const broken: string[] = [];
  const wrongSize: string[] = [];
  const drifted: string[] = [];
  const registered = new Set<string>();

  for (const f of rows) {
    let abs: string;
    try {
      abs = absolutePathFor(f.storedPath);
    } catch {
      broken.push(`${f.storedPath} (ruta inválida)`);
      continue;
    }
    registered.add(path.resolve(abs).toLowerCase());
    if (!fs.existsSync(abs)) {
      broken.push(`${f.storedPath} — ${f.originalName}`);
      continue;
    }
    const stat = fs.statSync(abs);
    if (stat.size !== f.sizeBytes) {
      wrongSize.push(`${f.storedPath} (registrado ${f.sizeBytes} B, en disco ${stat.size} B)`);
    }
    const desired = desiredPathForFile(f.id);
    if (desired && desired !== f.storedPath) drifted.push(`${f.storedPath} → ${desired}`);
  }

  // Archivos en disco que la base de datos no conoce
  const orphans: string[] = [];
  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (!registered.has(path.resolve(full).toLowerCase())) {
        orphans.push(path.relative(root, full));
      }
    }
  }
  walk(root);

  const report = (title: string, items: string[], hint?: string) => {
    if (items.length === 0) {
      console.log(`✓ ${title}: ninguno`);
      return;
    }
    console.log(`⚠ ${title}: ${items.length}`);
    for (const i of items.slice(0, 20)) console.log(`    ${i}`);
    if (items.length > 20) console.log(`    … y ${items.length - 20} más`);
    if (hint) console.log(`    → ${hint}`);
  };

  console.log(`${rows.length} archivo(s) registrados\n`);
  report("Registrados sin archivo en disco", broken, "Súbelos de nuevo desde la plataforma");
  report("Tamaño distinto al registrado", wrongSize, "Alguien los modificó fuera de la plataforma");
  report("Fuera de su carpeta legible", drifted, "Ejecuta «pnpm storage apply»");
  report("En disco sin registro", orphans, "Puedes borrarlos: la plataforma no los usa");

  const problems = broken.length + wrongSize.length + orphans.length;
  console.log(
    problems === 0 && drifted.length === 0
      ? "\n✅ Almacenamiento íntegro"
      : `\n${problems} incidencia(s) y ${drifted.length} archivo(s) por reorganizar`
  );
}

function cmdWhere() {
  const info = storageRootInfo();
  console.log(`Raíz:   ${info.root}`);
  console.log(`Origen: ${info.source}`);
  if (info.isUnc) console.log("Tipo:   recurso de red (UNC)");
  const rows = allFiles();
  const bytes = rows.reduce((s, f) => s + f.sizeBytes, 0);
  console.log(`Contenido: ${rows.length} archivo(s), ${(bytes / 1024 / 1024).toFixed(1)} MB`);
  console.log(`\nCarpetas: ${Object.values(TOP).join(", ")}`);
}

async function cmdMove() {
  const target = value("to");
  if (!target) {
    console.log('Falta la ruta: pnpm storage move --to "\\\\NAS\\Capacitacion"');
    process.exit(1);
  }
  const verdict = await checkStorageRoot(target);
  if (!verdict.ok) {
    console.log(`✗ ${verdict.error}`);
    process.exit(1);
  }
  if (verdict.warning) console.log(`⚠ ${verdict.warning}`);

  const from = storageRoot();
  const to = path.resolve(target);
  if (path.resolve(from).toLowerCase() === to.toLowerCase()) {
    console.log("La raíz ya es esa.");
    return;
  }

  const rows = allFiles();
  console.log(`Copiando ${rows.length} archivo(s)`);
  console.log(`  de ${from}`);
  console.log(`  a  ${to}\n`);

  let copied = 0;
  const failures: string[] = [];
  for (const f of rows) {
    const src = path.resolve(from, f.storedPath);
    const dst = path.resolve(to, f.storedPath);
    if (!fs.existsSync(src)) {
      failures.push(`sin archivo: ${f.storedPath}`);
      continue;
    }
    await fsp.mkdir(path.dirname(dst), { recursive: true });
    await fsp.copyFile(src, dst);
    // Verificar la copia por hash antes de dar por bueno el traslado
    const hash = createHash("sha256").update(await fsp.readFile(dst)).digest("hex");
    if (hash !== f.sha256) {
      failures.push(`copia distinta al original: ${f.storedPath}`);
      continue;
    }
    copied++;
    if (copied % 25 === 0) console.log(`  ${copied}/${rows.length}…`);
  }

  if (failures.length > 0) {
    console.log(`\n✗ ${failures.length} problema(s); NO se cambió la raíz:`);
    for (const f of failures.slice(0, 10)) console.log(`    ${f}`);
    process.exit(1);
  }

  setStorageRootSetting(to);
  console.log(`\n✓ ${copied} archivo(s) copiados y verificados por hash`);
  console.log(`✓ Raíz activa: ${to}`);
  console.log(`\nLa carpeta anterior sigue intacta en ${from}.`);
  console.log("Bórrala tú cuando compruebes que todo funciona.");
}

async function main() {
  switch (command) {
    case "plan": return cmdPlan();
    case "apply": return cmdApply();
    case "check": return cmdCheck();
    case "where": return cmdWhere();
    case "move": return cmdMove();
    default:
      console.log(
        [
          "Comandos:",
          "  plan                                    qué se movería (no toca nada)",
          "  apply [--purge-certs] [--purge-orphans] reorganiza en carpetas legibles",
          "  check                                   integridad del almacenamiento",
          "  where                                   raíz actual y de dónde sale",
          "  move --to <ruta>                        cambiar de raíz copiando todo",
        ].join("\n")
      );
      process.exit(1);
  }
}

main();
