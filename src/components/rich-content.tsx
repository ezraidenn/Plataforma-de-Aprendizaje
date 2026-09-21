import { isHtmlContent } from "@/lib/rich-html";
import { renderMarkdown } from "@/components/student/markdown";
import { cn } from "@/lib/utils";

/**
 * Muestra contenido enriquecido guardado por el editor: HTML (saneado en el
 * servidor al guardar) o markdown legado. Sin "use client": sirve en server y
 * client components.
 */
export function RichContent({ content, className }: { content: string; className?: string }) {
  if (!content?.trim()) return null;
  if (isHtmlContent(content)) {
    return (
      <div
        className={cn("rich-content", className)}
        dangerouslySetInnerHTML={{ __html: content }}
      />
    );
  }
  return <div className={cn("rich-content space-y-3", className)}>{renderMarkdown(content)}</div>;
}
