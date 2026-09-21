/** Frase de ayuda: convierte **texto** en negritas. */
export function Caption({ text, className }: { text: string; className?: string }) {
  const parts = text.split("**");
  return (
    <p className={className}>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <b key={i} className="font-semibold text-slate-900">
            {part}
          </b>
        ) : (
          part
        )
      )}
    </p>
  );
}
