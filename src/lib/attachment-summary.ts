/**
 * Lo que el servidor saca de un archivo adjunto y lo poco que ve la IA: nombre,
 * hojas, cuántas filas, encabezados, una muestra y qué colores de fila hay.
 * El archivo completo NUNCA se le manda: se procesa aparte, por tramos.
 * Puro: se prueba en `pnpm smoke:assistant`.
 */

export const MAX_SUMMARY_CHARS = 1_500;

export type ColorFamily = "rojo" | "verde" | "amarillo" | "azul" | "otro";

export type SheetSummary = {
  name: string;
  rowCount: number;
  headers: string[];
  /** Hasta 5 filas de ejemplo, ya recortadas */
  sample: string[][];
  /** Cuántas filas de cada familia de color (solo las que aparecen) */
  colors: Partial<Record<ColorFamily, number>>;
};

export type AttachmentSummary = {
  fileName: string;
  kind: "sheet" | "doc" | "image";
  sheets: SheetSummary[];
  /** Caracteres de texto extraídos (para saber si hará falta trocear) */
  chars: number;
};

/**
 * Familia de color de un relleno de celda. Los blancos y grises muy claros no
 * cuentan (son el fondo normal de la hoja). Se compara por tono, no por valor
 * exacto: cada quien pinta con un rojo distinto.
 */
export function colorFamily(hex: string): ColorFamily | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  // Casi blanco o gris: es el fondo, no una marca
  if (max - min < 24) return null;
  if (r === max && g < 200 && b < 200) return g > 150 ? "amarillo" : "rojo";
  if (r > 200 && g > 150 && b < 150) return "amarillo";
  if (g === max && r < 220) return "verde";
  // Azul de verdad tiene el verde por encima (o igual) del rojo; si el rojo
  // le gana al verde con el azul al frente, es un morado/violeta: "otro"
  if (b === max && r < 200 && r <= g) return "azul";
  return "otro";
}

const cut = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);

/** Texto para la IA: corto y suficiente para decidir qué herramienta usar. */
export function summaryForModel(summary: AttachmentSummary): string {
  const lines: string[] = [`Archivo adjunto: ${cut(summary.fileName, 80)}`];
  for (const sheet of summary.sheets) {
    lines.push(
      `- Hoja «${cut(sheet.name, 40)}»: ${sheet.rowCount} fila(s). Columnas: ${sheet.headers
        .map((h) => cut(h, 30))
        .join(" | ")}`
    );
    for (const row of sheet.sample.slice(0, 2)) {
      lines.push(`  ej.: ${row.map((c) => cut(c, 30)).join(" | ")}`);
    }
    const colors = Object.entries(sheet.colors).filter(([, n]) => n > 0);
    if (colors.length) {
      lines.push(`  filas pintadas: ${colors.map(([c, n]) => `${c} ${n}`).join(", ")}`);
    }
  }
  if (summary.sheets.length === 0) lines.push(`- Documento de ${summary.chars} caracteres de texto.`);
  lines.push("Para usarlo, llama a una herramienta con origen «adjunto»: el servidor lee el archivo completo, tú no.");
  const text = lines.join("\n");
  return text.length <= MAX_SUMMARY_CHARS ? text : `${text.slice(0, MAX_SUMMARY_CHARS - 1)}…`;
}

/** 12000 → «12 000»: se lee mejor en la tarjeta del adjunto. */
const grouped = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

/**
 * Una línea para la interfaz: «2 hojas · 94 filas», «84 filas»,
 * «PDF · 12 000 caracteres» o «Imagen».
 */
export function attachmentDetail(summary: AttachmentSummary): string {
  if (summary.kind === "image") return "Imagen";
  if (summary.sheets.length > 0) {
    const rows = summary.sheets.reduce((n, s) => n + s.rowCount, 0);
    const filas = `${grouped(rows)} ${rows === 1 ? "fila" : "filas"}`;
    return summary.sheets.length === 1 ? filas : `${summary.sheets.length} hojas · ${filas}`;
  }
  const ext = /\.([a-z0-9]{1,8})$/i.exec(summary.fileName)?.[1].toUpperCase();
  const chars = `${grouped(summary.chars)} caracteres`;
  return ext ? `${ext} · ${chars}` : chars;
}

const has = (headers: string[], words: string[]) =>
  headers.some((h) => {
    const clean = h.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    return words.some((w) => clean.includes(w));
  });

/**
 * Chips que se ofrecen al adjuntar, según los encabezados. Se calculan aquí,
 * sin gastar tokens; cada chip es un texto listo para enviar como mensaje.
 */
export function suggestionsFor(summary: AttachmentSummary): string[] {
  const headers = summary.sheets.flatMap((s) => s.headers);
  const colors = new Set(summary.sheets.flatMap((s) => Object.keys(s.colors)));
  const chips: string[] = [];

  const people = has(headers, ["correo", "email", "mail"]) || has(headers, ["nombre", "alumno", "estudiante"]);
  if (people) {
    chips.push("Da de alta a estos alumnos");
    chips.push("Matricúlalos en un curso");
    for (const color of ["rojo", "amarillo", "verde"]) {
      if (colors.has(color)) chips.push(`Da de baja a los que están en ${color}`);
    }
    if (chips.length < 3) chips.push("Da de baja a los de la lista");
  }
  if (has(headers, ["titulo", "curso"]) && !people) chips.push("Crea estos cursos");

  // Se deja un lugar fijo para «solo revisar»: sin él, tres sugerencias como
  // máximo (nunca se recorta a la de en medio de un color).
  const top = chips.slice(0, 3);
  top.push("Solo dime qué contiene");
  return top;
}
