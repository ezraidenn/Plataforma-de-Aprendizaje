/**
 * Piezas del contenido de los correos (estilo «Club», café y dorado). Solo el
 * contenido: el marco (logo, colores y pie) lo pone el servicio de correo.
 *
 * Reglas del servicio y de los programas de correo: tablas y estilos en línea,
 * nada de <style>, display:none, position, float ni transform, letra de 10 px
 * o más. Todo texto que llega de datos se escapa. Cada pieza trae también su
 * versión de solo texto.
 */

export const C = {
  brown: "#3B2618",
  button: "#4A2F1D",
  gold: "#B08D57",
  goldText: "#7A5C26",
  text: "#231B15",
  muted: "#6A5F56",
  soft: "#F5F3EE",
  border: "#E4DFD3",
  chip: "#EFE6DD",
  warnBg: "#FBF3E4",
  warnBorder: "#EAD6AE",
  warnText: "#6B4A12",
} as const;

const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "'Segoe UI', Helvetica, Arial, sans-serif";

export function esc(value: string | number): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Texto con *negritas* marcadas así; lo demás se escapa. */
function rich(text: string): string {
  return esc(text).replace(/\*([^*]+)\*/g, `<strong style="color:${C.text};">$1</strong>`);
}
const plain = (text: string) => text.replace(/\*([^*]+)\*/g, "$1");

type Part = { html: string; text: string };

export type Rendered = { subject: string; html: string; text: string };

/** Arma un correo pieza por pieza. */
export class MailBuilder {
  private parts: Part[] = [];
  private footer = "";

  constructor(readonly subject: string) {}

  private add(html: string, text: string) {
    this.parts.push({ html, text });
    return this;
  }

  /** Marca de la plataforma arriba del título (deja claro que es EduCountry). */
  brand() {
    return this.add(
      `<p style="margin:0 0 6px;font-family:${SANS};font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:${C.goldText};">EduCountry · Yucatán Country Club</p>`,
      "EduCountry · Yucatán Country Club"
    );
  }

  title(text: string) {
    return this.add(
      `<h1 style="margin:0 0 16px;font-family:${SERIF};font-weight:normal;font-size:26px;line-height:1.25;color:${C.brown};">${esc(text)}</h1>`,
      `\n${text.toUpperCase()}\n`
    );
  }

  p(text: string, opts: { small?: boolean; muted?: boolean } = {}) {
    const size = opts.small ? 13 : 15;
    const color = opts.muted ? C.muted : C.text;
    return this.add(
      `<p style="margin:0 0 16px;font-family:${SANS};font-size:${size}px;line-height:1.6;color:${color};">${rich(text)}</p>`,
      plain(text)
    );
  }

  /** Tabla de datos: «Tu usuario — laura@…». */
  facts(rows: [string, string][], opts: { highlightLast?: boolean } = {}) {
    const html = rows
      .map(([k, v], i) => {
        const warn = opts.highlightLast && i === rows.length - 1;
        return `<tr><td style="padding:6px 12px 6px 0;font-family:${SANS};font-size:14px;color:${warn ? C.warnText : C.muted};vertical-align:top;width:130px;">${esc(k)}</td><td style="padding:6px 0;font-family:${SANS};font-size:14px;font-weight:600;color:${warn ? C.warnText : C.text};">${esc(v)}</td></tr>`;
      })
      .join("");
    return this.add(
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 18px;background:${C.soft};border:1px solid ${C.border};border-radius:10px;"><tr><td style="padding:12px 18px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${html}</table></td></tr></table>`,
      rows.map(([k, v]) => `${k}: ${v}`).join("\n")
    );
  }

  button(label: string, url: string) {
    return this.add(
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px;"><tr><td style="border-radius:8px;background:${C.button};"><a href="${esc(url)}" style="display:inline-block;padding:14px 30px;font-family:${SANS};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${esc(label)}</a></td></tr></table>`,
      `${label}: ${url}`
    );
  }

  /** Botón secundario (contorno). */
  ghostButton(label: string, url: string) {
    return this.add(
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;"><tr><td style="border-radius:8px;border:1px solid ${C.brown};background:#ffffff;"><a href="${esc(url)}" style="display:inline-block;padding:11px 22px;font-family:${SANS};font-size:14px;font-weight:600;color:${C.brown};text-decoration:none;border-radius:8px;">${esc(label)}</a></td></tr></table>`,
      `${label}: ${url}`
    );
  }

  /** Enlace de respaldo por si el botón no abre. */
  fallback(intro: string, url: string) {
    return this.add(
      `<p style="margin:0 0 18px;font-family:${SANS};font-size:13px;line-height:1.6;color:${C.muted};">${esc(intro)} ¿No abre el botón? Copia esta dirección en tu navegador:<br><a href="${esc(url)}" style="color:${C.button};word-break:break-all;">${esc(url)}</a></p>`,
      `${intro} Si el botón no abre, copia esta dirección: ${url}`
    );
  }

  link(label: string, url: string) {
    return this.add(
      `<p style="margin:0 0 16px;font-family:${SANS};font-size:14px;"><a href="${esc(url)}" style="color:${C.button};font-weight:600;text-decoration:none;">${esc(label)} →</a></p>`,
      `${label}: ${url}`
    );
  }

  note(title: string, body: string, tone: "neutral" | "warn" = "neutral") {
    const bg = tone === "warn" ? C.warnBg : C.soft;
    const bd = tone === "warn" ? C.warnBorder : C.border;
    const tc = tone === "warn" ? C.warnText : C.brown;
    return this.add(
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 18px;background:${bg};border:1px solid ${bd};border-radius:10px;"><tr><td style="padding:14px 18px;font-family:${SANS};font-size:14px;line-height:1.6;color:${C.text};"><strong style="color:${tc};">${esc(title)}</strong><br>${rich(body)}</td></tr></table>`,
      `${title} ${plain(body)}`
    );
  }

  /** Texto escrito por una persona (aviso del maestro): respeta sus saltos de línea. */
  quote(body: string) {
    return this.add(
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 18px;background:${C.soft};border-radius:10px;"><tr><td style="padding:16px 20px;font-family:${SANS};font-size:15px;line-height:1.6;color:${C.text};white-space:pre-line;">${esc(body)}</td></tr></table>`,
      body
    );
  }

  /** Lista de tarjetas (cursos, pendientes): título, líneas y un enlace por tarjeta. */
  cards(
    items: {
      chip?: { label: string; tone?: "neutral" | "warn" };
      title: string;
      lines: string[];
      aside?: string;
      link?: { label: string; url: string };
    }[]
  ) {
    const rows = items
      .map((it, i) => {
        const chip = it.chip
          ? `<span style="display:inline-block;margin:0 0 4px;padding:2px 8px;border-radius:4px;font-family:${SANS};font-size:11px;font-weight:600;letter-spacing:0.8px;text-transform:uppercase;background:${it.chip.tone === "warn" ? C.warnBg : C.chip};color:${it.chip.tone === "warn" ? C.warnText : C.brown};">${esc(it.chip.label)}</span><br>`
          : "";
        const lines = it.lines
          .map((l) => `<span style="font-family:${SANS};font-size:13px;line-height:1.6;color:${C.muted};">${rich(l)}</span><br>`)
          .join("");
        const link = it.link
          ? `<a href="${esc(it.link.url)}" style="font-family:${SANS};font-size:14px;font-weight:600;color:${C.button};text-decoration:none;">${esc(it.link.label)} →</a>`
          : "";
        const top = i > 0 ? `border-top:1px solid ${C.border};` : "";
        const aside = it.aside
          ? `<td style="${top}padding:16px 18px 16px 0;vertical-align:top;text-align:right;white-space:nowrap;font-family:${SANS};font-size:13px;font-weight:600;color:${C.warnText};">${esc(it.aside)}</td>`
          : "";
        return `<tr><td style="${top}padding:16px 18px;vertical-align:top;">${chip}<span style="font-family:${SERIF};font-size:18px;line-height:1.35;color:${C.brown};">${esc(it.title)}</span><br>${lines}${link}</td>${aside}</tr>`;
      })
      .join("");
    const text = items
      .map((it) =>
        [`- ${it.chip ? `[${it.chip.label}] ` : ""}${it.title}${it.aside ? ` (${it.aside})` : ""}`, ...it.lines.map((l) => `  ${plain(l)}`), ...(it.link ? [`  ${it.link.label}: ${it.link.url}`] : [])].join("\n")
      )
      .join("\n");
    return this.add(
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 18px;border:1px solid ${C.border};border-radius:10px;">${rows}</table>`,
      text
    );
  }

  /** Cifras grandes en fila (resumen del maestro). */
  stats(items: { value: number; label: string; tone?: "dark" | "soft" | "warn" }[]) {
    const width = Math.floor(100 / items.length);
    const cells = items
      .map((it, i) => {
        const bg = it.tone === "dark" ? C.brown : it.tone === "warn" ? C.warnBg : C.soft;
        const num = it.tone === "dark" ? "#ffffff" : it.tone === "warn" ? C.warnText : C.brown;
        const lab = it.tone === "dark" ? "#D9C08F" : it.tone === "warn" ? C.warnText : C.muted;
        const pad = i < items.length - 1 ? "padding-right:10px;" : "";
        return `<td width="${width}%" style="${pad}vertical-align:top;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${bg};border-radius:10px;"><tr><td style="padding:14px 8px;text-align:center;"><span style="font-family:${SERIF};font-size:30px;line-height:1.1;color:${num};">${it.value}</span><br><span style="font-family:${SANS};font-size:12px;color:${lab};">${esc(it.label)}</span></td></tr></table></td>`;
      })
      .join("");
    return this.add(
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 20px;"><tr>${cells}</tr></table>`,
      items.map((it) => `${it.value} ${it.label}`).join(" · ")
    );
  }

  section(label: string, tone: "neutral" | "warn" = "neutral") {
    return this.add(
      `<p style="margin:8px 0 6px;font-family:${SANS};font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${tone === "warn" ? C.warnText : C.brown};">${esc(label)}</p>`,
      `\n${label.toUpperCase()}`
    );
  }

  /** Pasos numerados (círculo café con el número). */
  steps(items: string[]) {
    const rows = items
      .map(
        (s, i) =>
          `<tr><td style="padding:0 12px 10px 0;vertical-align:top;width:22px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="22" height="22" style="width:22px;height:22px;border-radius:11px;background:${C.brown};text-align:center;font-family:${SANS};font-size:12px;line-height:22px;color:#ffffff;">${i + 1}</td></tr></table></td><td style="padding:1px 0 10px;vertical-align:top;font-family:${SANS};font-size:14px;line-height:1.6;color:${C.text};">${rich(s)}</td></tr>`
      )
      .join("");
    return this.add(
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 12px;">${rows}</table>`,
      items.map((s, i) => `${i + 1}. ${plain(s)}`).join("\n")
    );
  }

  /** Recuadro de certificado. */
  certificate(course: string, person: string) {
    return this.add(
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 18px;border:1px solid ${C.gold};border-radius:12px;"><tr><td style="padding:6px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FBFAF6;border:1px solid ${C.border};border-radius:8px;"><tr><td style="padding:22px 24px;text-align:center;"><span style="font-family:${SANS};font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${C.goldText};">Certificado de aprobación</span><br><span style="font-family:${SERIF};font-size:23px;line-height:1.35;color:${C.brown};">${esc(course)}</span><br><span style="font-family:${SANS};font-size:14px;color:${C.muted};">otorgado a <strong style="color:${C.text};">${esc(person)}</strong></span></td></tr></table></td></tr></table>`,
      `CERTIFICADO DE APROBACIÓN\n${course}\notorgado a ${person}`
    );
  }

  divider() {
    return this.add(`<hr style="margin:4px 0 18px;border:0;border-top:1px solid ${C.border};">`, "");
  }

  /** Pie propio de este correo (el servicio lo pone en su pie). */
  foot(text: string) {
    this.footer = text;
    return this;
  }

  build(): Rendered {
    const html =
      `<div style="font-family:${SANS};color:${C.text};">` +
      this.parts.map((p) => p.html).join("") +
      `</div>` +
      (this.footer ? `<!--pie-->${esc(this.footer)}` : "");
    const text =
      this.parts
        .map((p) => p.text)
        .filter(Boolean)
        .join("\n\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim() + (this.footer ? `\n\n—\n${this.footer}` : "");
    return { subject: this.subject, html, text };
  }
}
