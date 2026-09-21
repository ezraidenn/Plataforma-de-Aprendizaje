import sanitizeHtml from "sanitize-html";

/**
 * Saneado de HTML enriquecido (editor TipTap). Conserva formato, colores,
 * tamaños, tablas, alineación y sangrías; descarta fuentes, scripts y
 * cualquier URL que no sea http(s) o del propio storage.
 */
const STYLE_ALLOW: Record<string, RegExp[]> = {
  color: [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i, /^[a-z]{3,20}$/i],
  "background-color": [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i, /^[a-z]{3,20}$/i],
  "text-align": [/^(left|right|center|justify)$/],
  "font-size": [/^\d{1,2}(\.\d+)?(px|pt|em|rem)$/],
  "font-weight": [/^(bold|normal|[1-9]00)$/],
  "font-style": [/^(italic|normal)$/],
  "text-decoration": [/^(underline|line-through|none)( (underline|line-through))?$/],
  "margin-left": [/^\d{1,3}(px|em|rem|pt)$/],
  "padding-left": [/^\d{1,3}(px|em|rem|pt)$/],
  "text-indent": [/^\d{1,3}(px|em|rem|pt)$/],
  width: [/^\d{1,4}(px|%)$/],
  "vertical-align": [/^(top|middle|bottom)$/],
  "border-color": [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i],
};

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "code",
    "strong", "b", "em", "i", "u", "s", "strike", "del", "sup", "sub", "mark", "span",
    "ul", "ol", "li", "a", "img", "hr",
    "table", "thead", "tbody", "tfoot", "tr", "th", "td", "colgroup", "col", "div",
  ],
  allowedAttributes: {
    "*": ["style"],
    a: ["href", "target", "rel"],
    img: ["src", "alt", "width", "height"],
    ol: ["start", "type"],
    th: ["colspan", "rowspan"],
    td: ["colspan", "rowspan"],
    col: ["span"],
    // TipTap marca las celdas de tabla con colwidth
    "*[data-colwidth]": [],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["http", "https", "data"] },
  allowProtocolRelative: false,
  allowedStyles: { "*": STYLE_ALLOW },
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer nofollow" },
    }),
    // Etiquetas legadas de Word/Office → equivalentes semánticos
    font: "span",
    center: "p",
  },
  exclusiveFilter: (frame) =>
    // Elimina imágenes externas: solo se aceptan las del propio storage o data URL (pegado)
    frame.tag === "img" &&
    !!frame.attribs.src &&
    !/^\/api\/files\//.test(frame.attribs.src) &&
    !/^data:image\//.test(frame.attribs.src),
};

export function sanitizeRichHtml(html: string): string {
  return sanitizeHtml(html ?? "", OPTIONS).trim();
}

/** Heurística: el contenido guardado es HTML (nuevo) o markdown legado. */
export function isHtmlContent(content: string | null | undefined): boolean {
  return /^\s*</.test(content ?? "");
}

/** Texto plano aproximado (para resúmenes/vistas previas). */
export function htmlToPlainText(html: string): string {
  return sanitizeHtml(html ?? "", { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, " ")
    .trim();
}
