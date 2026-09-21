/** Render de prueba de los 5 presets de adornos (detecta errores de dibujo). */
import fs from "node:fs";
import { renderCertificatePdf } from "../src/server/services/certificates";
import { DECOR_PRESETS } from "../src/lib/certificate-decor";

async function main() {
  const fields = [
    { key: "student_name" as const, x: 396, y: 220, fontSize: 34, font: "times_bold" as const, color: "#3e2b23", align: "center" as const, maxWidth: 580 },
    { key: "course_title" as const, x: 396, y: 320, fontSize: 22, font: "helvetica_bold" as const, color: "#5d4037", align: "center" as const },
    { key: "teacher_name" as const, x: 396, y: 480, fontSize: 14, font: "times_bold" as const, color: "#3e2b23", align: "center" as const },
    { key: "folio" as const, x: 396, y: 560, fontSize: 10, font: "helvetica" as const, color: "#6b5b51", align: "center" as const },
    { key: "qr" as const, x: 660, y: 460, fontSize: 84, font: "helvetica" as const, color: "#000000", align: "left" as const },
    { key: "date" as const, x: 396, y: 380, fontSize: 13, font: "helvetica" as const, color: "#6b5b51", align: "center" as const, enabled: false },
  ];

  fs.mkdirSync("backups/decor-preview", { recursive: true });
  for (const preset of [...DECOR_PRESETS.map((p) => p.id), null]) {
    const bytes = await renderCertificatePdf(
      { backgroundFileId: null, fields, pageSize: "letter", orientation: "landscape", decor: preset },
      {
        studentName: "María Fernanda de los Ángeles Gutiérrez Bustamante",
        courseTitle: "Uso y Manejo de Extintores — NOM-002-STPS-2010",
        date: "28 de julio de 2026",
        score: "95",
        folio: "CERT-2026-000099-DEMO",
        teacherName: "Prof. Roberto Martínez",
        verifyUrl: "http://localhost:3000/verify/CERT-2026-000099-DEMO",
      }
    );
    const name = preset ?? "sin-adornos";
    const path = `backups/decor-preview/preset-${name}.pdf`;
    fs.writeFileSync(path, bytes);
    const ok = Buffer.from(bytes.slice(0, 5)).toString() === "%PDF-";
    console.log(`${ok ? "✓" : "✗"} ${name} (${(bytes.length / 1024).toFixed(1)} KB) → ${path}`);
  }
  console.log("\nAbre backups/decor-preview/ para ver los 5 diseños.");
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
