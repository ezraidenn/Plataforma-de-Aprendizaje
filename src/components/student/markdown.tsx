// ─── Mini-renderizador de markdown compartido (sin dependencias) ─────────────
// Soporta: encabezados #/##/###, listas "- " y "1. ", citas "> ", **negritas**,
// *cursivas*, párrafos y saltos de línea. Todo se renderiza como nodos React:
// el HTML queda escapado. Lo usan los visores del estudiante y las
// instrucciones de tarea/examen (el editor enriquecido del maestro emite
// exactamente este subconjunto).

export function renderInline(text: string): React.ReactNode[] {
  // Primero negritas (**...**), luego cursivas (*...*) dentro de cada tramo
  const boldParts = text.split(/\*\*(.+?)\*\*/g);
  let key = 0;
  const out: React.ReactNode[] = [];

  const pushWithItalics = (chunk: string, wrapBold: boolean) => {
    const italicParts = chunk.split(/(?<!\*)\*(?!\*)([^*]+)\*(?!\*)/g);
    const nodes = italicParts.map((part, i) =>
      i % 2 === 1 ? <em key={`i${key++}`}>{part}</em> : <span key={`s${key++}`}>{part}</span>
    );
    out.push(wrapBold ? <strong key={`b${key++}`}>{nodes}</strong> : <span key={`w${key++}`}>{nodes}</span>);
  };

  boldParts.forEach((part, i) => pushWithItalics(part, i % 2 === 1));
  return out;
}

type ListKind = "ul" | "ol";

function renderLines(lines: string[]): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let listKind: ListKind = "ul";
  let quote: string[] = [];
  let key = 0;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    out.push(
      <p key={key++} className="leading-relaxed">
        {paragraph.map((line, i) => (
          <span key={i}>
            {i > 0 && <br />}
            {renderInline(line)}
          </span>
        ))}
      </p>
    );
    paragraph = [];
  };

  const flushList = () => {
    if (list.length === 0) return;
    const items = list.map((item, i) => <li key={i}>{renderInline(item)}</li>);
    out.push(
      listKind === "ul" ? (
        <ul key={key++} className="list-disc space-y-1 pl-6">
          {items}
        </ul>
      ) : (
        <ol key={key++} className="list-decimal space-y-1 pl-6">
          {items}
        </ol>
      )
    );
    list = [];
  };

  const flushQuote = () => {
    if (quote.length === 0) return;
    out.push(
      <blockquote
        key={key++}
        className="rounded-r-lg border-l-4 border-brand-soft bg-brand-tint/50 px-3 py-1.5"
      >
        {quote.map((line, i) => (
          <span key={i}>
            {i > 0 && <br />}
            {renderInline(line)}
          </span>
        ))}
      </blockquote>
    );
    quote = [];
  };

  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    const ordered = /^\d+[.)]\s+(.*)$/.exec(line);
    const quoted = /^>\s?(.*)$/.exec(line);

    if (line.trim() === "") {
      flushAll();
    } else if (heading) {
      flushAll();
      const level = heading[1].length;
      const content = renderInline(heading[2]);
      if (level === 1) {
        out.push(
          <h2 key={key++} className="font-heading text-2xl font-semibold">
            {content}
          </h2>
        );
      } else if (level === 2) {
        out.push(
          <h3 key={key++} className="font-heading text-xl font-semibold">
            {content}
          </h3>
        );
      } else {
        out.push(
          <h4 key={key++} className="font-heading text-lg font-semibold">
            {content}
          </h4>
        );
      }
    } else if (quoted) {
      flushParagraph();
      flushList();
      quote.push(quoted[1]);
    } else if (bullet || ordered) {
      flushParagraph();
      flushQuote();
      const kind: ListKind = bullet ? "ul" : "ol";
      if (list.length > 0 && kind !== listKind) flushList();
      listKind = kind;
      list.push((bullet ?? ordered)![1]);
    } else {
      flushList();
      flushQuote();
      paragraph.push(line);
    }
  }
  flushAll();
  return out;
}

/** Renderiza un bloque de markdown completo como nodos React. */
export function renderMarkdown(content: string): React.ReactNode[] {
  return renderLines(content.split(/\r?\n/));
}
