"use client";

import { useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  Check,
  ClipboardCheck,
  Download,
  ExternalLink,
  RotateCcw,
  TriangleAlert,
  User,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { AssistantBlock, AssistantMessage, LinkIcon } from "@/lib/assistant-blocks";
import { undoAction } from "@/server/actions/assistant";
import { AttachmentChip } from "./attachment-chip";
import { useAssistant } from "./assistant-provider";
import { ReviewTable } from "./review-table";

const LINK_ICONS: Record<LinkIcon, LucideIcon> = {
  user: User,
  course: BookOpen,
  grading: ClipboardCheck,
  download: Download,
  page: ExternalLink,
};

const BUBBLE_ASSISTANT = "rounded-xl rounded-bl-sm border border-slate-100 bg-slate-50 px-3 py-2 text-[13px] leading-relaxed text-slate-800";

/** Solo `**negritas**`; nada más de Markdown. */
function inline(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
      <strong key={i} className="font-semibold">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    )
  );
}

/** Párrafos y viñetas («- »). */
function RichText({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  const out: React.ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) {
      out.push(
        <ul key={`ul-${out.length}`} className="my-1 list-disc space-y-0.5 pl-4">
          {bullets.map((b, i) => (
            <li key={i}>{inline(b)}</li>
          ))}
        </ul>
      );
      bullets = [];
    }
  };
  lines.forEach((line, i) => {
    if (line.startsWith("- ")) {
      bullets.push(line.slice(2));
      return;
    }
    flush();
    if (line.trim() === "") return;
    out.push(
      <p key={`p-${i}`} className="my-0.5">
        {inline(line)}
      </p>
    );
  });
  flush();
  return <>{out}</>;
}

function ResultCard({ block, message, conversationId }: { block: Extract<AssistantBlock, { type: "result" }>; message: AssistantMessage; conversationId: string | null }) {
  const { replaceMessage } = useAssistant();
  const [busy, setBusy] = useState(false);
  const undo = async () => {
    if (!conversationId) return;
    setBusy(true);
    try {
      const result = await undoAction({ conversationId, messageId: message.id });
      if ("error" in result) {
        toast.error(result.error, { position: "top-center" });
        return;
      }
      toast.success(result.text, { position: "top-center" });
      replaceMessage({ ...message, blocks: message.blocks.map((b) => (b.type === "result" ? { ...b, undone: true } : b)) });
    } catch {
      toast.error("No se pudo deshacer. Inténtalo de nuevo.", { position: "top-center" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-xl border px-3 py-2 text-[13px]",
        block.undone ? "border-slate-200 bg-slate-50 text-slate-500" : "border-green-200 bg-green-50 text-green-800"
      )}
    >
      <Check className="mt-0.5 size-4 shrink-0" aria-hidden />
      {/* Una línea, pero con sus negritas: el nombre de lo que se acaba de hacer se lee de un vistazo */}
      <span className={cn("min-w-0 flex-1", block.undone && "line-through")}>{inline(block.text)}</span>
      {block.undoable && !block.undone && (
        <button
          type="button"
          onClick={() => void undo()}
          disabled={busy}
          className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold text-green-900 hover:bg-green-100 disabled:opacity-50"
        >
          <RotateCcw className="size-3.5" aria-hidden />
          Deshacer
        </button>
      )}
      {block.undone && <span className="shrink-0 text-[11px]">Deshecho</span>}
    </div>
  );
}

function Block({ block, message, conversationId }: { block: AssistantBlock; message: AssistantMessage; conversationId: string | null }) {
  const { send, retry, replaceMessage, busy } = useAssistant();
  switch (block.type) {
    case "text":
      return (
        <div className={BUBBLE_ASSISTANT}>
          <RichText text={block.text} />
        </div>
      );
    case "options":
      return (
        <div className="flex flex-col gap-2">
          <div className={BUBBLE_ASSISTANT}>
            <RichText text={block.text} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {block.options.map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => void send(o)}
                disabled={busy}
                className="rounded-full border border-indigo-200 bg-white px-3 py-1 text-[11.5px] font-semibold text-indigo-900 hover:bg-indigo-50 disabled:opacity-50"
              >
                {o}
              </button>
            ))}
          </div>
        </div>
      );
    case "tiles":
      return (
        <div className="flex flex-wrap gap-2">
          {block.tiles.map((t, i) => (
            <div key={i} className="min-w-[72px] rounded-lg border border-slate-200 bg-white px-2.5 py-2">
              <div className="font-heading text-base font-bold text-slate-900">{t.value}</div>
              <div className="text-[10.5px] text-slate-500">{t.label}</div>
            </div>
          ))}
        </div>
      );
    case "table": {
      // Con muchas columnas (un listado trae 8) el panel de 440 px parte cada
      // título en ocho renglones: se pasa a una línea por celda, con corte y
      // desplazamiento lateral. Con pocas columnas se deja envolver, que cabe.
      const ancha = block.columns.length > 4;
      return (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className={cn("text-[12px]", ancha ? "w-max min-w-full" : "w-full")}>
            <thead>
              <tr className="border-b border-slate-200">
                {block.columns.map((c) => (
                  <th key={c} scope="col" className={cn("px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500", ancha && "whitespace-nowrap")}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((r, i) => (
                <tr key={i} className="border-b border-slate-100 last:border-0">
                  {r.map((cell, j) => (
                    <td
                      key={j}
                      title={ancha ? cell : undefined}
                      className={cn("px-2 py-1 text-slate-800", ancha && "max-w-[220px] truncate whitespace-nowrap")}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {block.more ? <p className="px-2 py-1.5 text-[11px] text-slate-500">y {block.more} más</p> : null}
        </div>
      );
    }
    case "links":
      return (
        <div className="flex flex-wrap gap-1.5">
          {block.links.map((l, i) => {
            const Icon = LINK_ICONS[l.icon] ?? ExternalLink;
            return (
              <Link
                key={i}
                href={l.href}
                className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11.5px] font-semibold text-slate-800 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-900"
              >
                <Icon className="size-3.5 text-indigo-600" aria-hidden />
                {l.label}
              </Link>
            );
          })}
        </div>
      );
    case "download":
      // Enlace de verdad (no <Link>): lo sirve una ruta de API, no una pantalla
      return (
        <a
          href={block.href}
          download
          className="flex w-fit max-w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 hover:border-indigo-200 hover:bg-indigo-50"
        >
          <Download className="size-4 shrink-0 text-indigo-600" aria-hidden />
          <span className="min-w-0">
            <span className="block text-[12px] font-semibold text-slate-900">{block.label}</span>
            {block.detail ? <span className="block text-[11px] text-slate-500">{block.detail}</span> : null}
          </span>
        </a>
      );
    case "result":
      return <ResultCard block={block} message={message} conversationId={conversationId} />;
    case "proposal":
      return (
        <ReviewTable
          block={block}
          onChange={(next, extra) =>
            replaceMessage({
              ...message,
              blocks: [
                ...message.blocks.map((b) => (b.type === "proposal" && b.proposalId === next.proposalId ? next : b)),
                // Lo que dejó la acción (descarga de contraseñas, enlaces) va al final
                ...(extra ?? []),
              ],
            })
          }
        />
      );
    case "navigate":
      return null;
    case "error":
      return (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">{block.text}</span>
          {block.retryable && (
            <button
              type="button"
              onClick={() => void retry()}
              disabled={busy}
              className="shrink-0 rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold text-red-900 hover:bg-red-100 disabled:opacity-50"
            >
              Reintentar
            </button>
          )}
        </div>
      );
    default:
      return null;
  }
}

/** Un mensaje del hilo: burbuja del usuario o columna de bloques del asistente. */
export function AssistantMessageView({ message, conversationId }: { message: AssistantMessage; conversationId: string | null }) {
  if (message.role === "user") {
    // Solo los bloques de texto se juntan: los demás (adjuntos) dejaban un
    // salto de línea de más al final de la burbuja
    const text = message.blocks.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
    const files = message.blocks.filter((b): b is Extract<AssistantBlock, { type: "attachment" }> => b.type === "attachment");
    return (
      <UserBubble text={text}>
        {files.length > 0 && (
          <div className="mt-1.5 flex flex-col gap-1.5">
            {files.map((f, i) => (
              <AttachmentChip key={i} name={f.name} detail={f.detail} className="border-indigo-100" />
            ))}
          </div>
        )}
      </UserBubble>
    );
  }
  return (
    <div className="flex max-w-[96%] flex-col gap-2">
      {message.blocks.map((block, i) => (
        <Block key={i} block={block} message={message} conversationId={conversationId} />
      ))}
    </div>
  );
}

export function UserBubble({ text, children }: { text: string; children?: React.ReactNode }) {
  return (
    <div className="ml-auto max-w-[88%] rounded-xl rounded-br-sm bg-indigo-50 px-3 py-2 text-[13px] text-indigo-950">
      {text && <p className="whitespace-pre-wrap">{text}</p>}
      {children}
    </div>
  );
}
