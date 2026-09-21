"use client";

import { useCallback, useRef } from "react";
import { useEditor, EditorContent, Extension, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  TextQuote,
  Undo2,
  Redo2,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Baseline,
  Highlighter,
  Table2,
  Link2,
  ImagePlus,
  RemoveFormatting,
  IndentIncrease,
  IndentDecrease,
  Rows3,
  Columns3,
  Trash2,
  Minus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isHtmlContent } from "@/lib/rich-html";
import { toast } from "sonner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Editor de texto enriquecido (maestro y alumno). Guarda **HTML** saneado en
 * servidor. Al pegar desde Word/Excel/web conserva colores, tamaños, tablas,
 * alineación y sangrías — pero descarta las FUENTES, que se normalizan a las
 * de la plataforma. Acepta contenido legado en markdown (lo convierte al abrir).
 */

// ─── Extensiones extra: tamaño de fuente y sangría (se conservan al pegar) ───

const FontSize = Extension.create({
  name: "fontSize",
  addGlobalAttributes() {
    return [
      {
        types: ["textStyle"],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (el) => el.style.fontSize?.replace(/['"]/g, "") || null,
            renderHTML: (attrs) =>
              attrs.fontSize ? { style: `font-size: ${attrs.fontSize}` } : {},
          },
        },
      },
    ];
  },
});

const INDENT_STEP = 24; // px
const INDENT_MAX = 8;

const Indent = Extension.create({
  name: "indent",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          indent: {
            default: 0,
            parseHTML: (el) => {
              const raw = el.style.marginLeft || el.style.paddingLeft || el.style.textIndent;
              const px = raw ? parseFloat(raw) * (/em|rem/.test(raw) ? 16 : /pt/.test(raw) ? 1.33 : 1) : 0;
              return Math.min(INDENT_MAX, Math.max(0, Math.round(px / INDENT_STEP)));
            },
            renderHTML: (attrs) =>
              attrs.indent ? { style: `margin-left: ${attrs.indent * INDENT_STEP}px` } : {},
          },
        },
      },
    ];
  },
});

const CellBackground = Extension.create({
  name: "cellBackground",
  addGlobalAttributes() {
    return [
      {
        types: ["tableCell", "tableHeader"],
        attributes: {
          backgroundColor: {
            default: null,
            parseHTML: (el) => el.style.backgroundColor || el.getAttribute("bgcolor") || null,
            renderHTML: (attrs) =>
              attrs.backgroundColor ? { style: `background-color: ${attrs.backgroundColor}` } : {},
          },
        },
      },
    ];
  },
});

/** Quita fuentes (font-family / <font face>) y basura de Office del HTML pegado. */
function stripFontsFromPastedHtml(html: string): string {
  return html
    .replace(/font-family\s*:[^;"']*;?/gi, "")
    .replace(/<font([^>]*)\sface="[^"]*"([^>]*)>/gi, "<font$1$2>")
    .replace(/<\/?o:p>/gi, "")
    .replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, "")
    .replace(/\sclass="Mso[^"]*"/gi, "")
    .replace(/mso-[a-z-]+\s*:[^;"']*;?/gi, "");
}

async function uploadEditorImage(file: File): Promise<string> {
  const res = await fetch("/api/uploads", {
    method: "POST",
    headers: {
      "Content-Type": file.type,
      "X-File-Name": encodeURIComponent(file.name || "imagen.png"),
      "X-File-Kind": "editor_image",
    },
    body: file,
  });
  const data = (await res.json()) as { fileId?: string; error?: string };
  if (!res.ok || !data.fileId) throw new Error(data.error ?? "No se pudo subir la imagen");
  return `/api/files/${data.fileId}`;
}

// ─── Barra de herramientas ───────────────────────────────────────────────────

function ToolbarButton({
  onClick,
  active,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()} // no robar el foco del editor
          onClick={onClick}
          className={cn(
            "flex size-8 items-center justify-center rounded-md transition-colors",
            active
              ? "bg-section-soft text-section-strong"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
            disabled && "pointer-events-none opacity-40"
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

function Divider() {
  return <span className="mx-1 h-5 w-px bg-border" aria-hidden />;
}

function ColorButton({
  label,
  value,
  onPick,
  onClear,
  children,
}: {
  label: string;
  value: string;
  onPick: (hex: string) => void;
  onClear: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <span className="relative flex items-center">
      <ToolbarButton label={label} onClick={() => ref.current?.click()}>
        <span className="relative">
          {children}
          <span
            aria-hidden
            className="absolute -bottom-1 left-0 right-0 h-[3px] rounded-full"
            style={{ background: value || "currentColor" }}
          />
        </span>
      </ToolbarButton>
      <input
        ref={ref}
        type="color"
        tabIndex={-1}
        aria-hidden
        className="pointer-events-none absolute left-0 top-full size-0 opacity-0"
        value={value || "#000000"}
        onChange={(e) => onPick(e.target.value)}
        onDoubleClick={onClear}
      />
    </span>
  );
}

function Toolbar({
  editor,
  onPickImage,
  compact,
}: {
  editor: Editor;
  onPickImage: () => void;
  compact: boolean;
}) {
  const setLink = () => {
    const prev = (editor.getAttributes("link").href as string | undefined) ?? "";
    const url = window.prompt("Dirección del enlace (https://…)", prev);
    if (url === null) return;
    if (url.trim() === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
  };

  const inTable = editor.isActive("table");
  const color = (editor.getAttributes("textStyle").color as string | undefined) ?? "";
  const highlight = (editor.getAttributes("highlight").color as string | undefined) ?? "";

  return (
    <TooltipProvider delayDuration={300}>
      <div
        role="toolbar"
        aria-label="Formato de texto"
        className="flex flex-wrap items-center gap-0.5 border-b bg-secondary/50 px-2 py-1.5"
      >
        <ToolbarButton label="Negritas (Ctrl+B)" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold className="size-4" aria-hidden />
        </ToolbarButton>
        <ToolbarButton label="Cursivas (Ctrl+I)" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic className="size-4" aria-hidden />
        </ToolbarButton>
        <ToolbarButton label="Subrayado (Ctrl+U)" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <UnderlineIcon className="size-4" aria-hidden />
        </ToolbarButton>
        <ToolbarButton label="Tachado" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
          <Strikethrough className="size-4" aria-hidden />
        </ToolbarButton>

        <Divider />

        <ColorButton
          label="Color de texto (doble clic para quitar)"
          value={color}
          onPick={(hex) => editor.chain().focus().setColor(hex).run()}
          onClear={() => editor.chain().focus().unsetColor().run()}
        >
          <Baseline className="size-4" aria-hidden />
        </ColorButton>
        <ColorButton
          label="Resaltado (doble clic para quitar)"
          value={highlight}
          onPick={(hex) => editor.chain().focus().setHighlight({ color: hex }).run()}
          onClear={() => editor.chain().focus().unsetHighlight().run()}
        >
          <Highlighter className="size-4" aria-hidden />
        </ColorButton>

        <Divider />

        {!compact && (
          <>
            <ToolbarButton label="Título grande" active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
              <Heading1 className="size-4" aria-hidden />
            </ToolbarButton>
            <ToolbarButton label="Título" active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
              <Heading2 className="size-4" aria-hidden />
            </ToolbarButton>
            <ToolbarButton label="Subtítulo" active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
              <Heading3 className="size-4" aria-hidden />
            </ToolbarButton>
            <Divider />
          </>
        )}

        <ToolbarButton label="Alinear a la izquierda" active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()}>
          <AlignLeft className="size-4" aria-hidden />
        </ToolbarButton>
        <ToolbarButton label="Centrar" active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()}>
          <AlignCenter className="size-4" aria-hidden />
        </ToolbarButton>
        <ToolbarButton label="Alinear a la derecha" active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()}>
          <AlignRight className="size-4" aria-hidden />
        </ToolbarButton>
        <ToolbarButton label="Justificar" active={editor.isActive({ textAlign: "justify" })} onClick={() => editor.chain().focus().setTextAlign("justify").run()}>
          <AlignJustify className="size-4" aria-hidden />
        </ToolbarButton>

        <Divider />

        <ToolbarButton label="Lista con viñetas" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List className="size-4" aria-hidden />
        </ToolbarButton>
        <ToolbarButton label="Lista numerada" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered className="size-4" aria-hidden />
        </ToolbarButton>
        <ToolbarButton
          label="Aumentar sangría"
          onClick={() => {
            if (editor.isActive("listItem")) {
              editor.chain().focus().sinkListItem("listItem").run();
              return;
            }
            const type = editor.isActive("heading") ? "heading" : "paragraph";
            const cur = (editor.getAttributes(type).indent as number) ?? 0;
            editor.chain().focus().updateAttributes(type, { indent: Math.min(INDENT_MAX, cur + 1) }).run();
          }}
        >
          <IndentIncrease className="size-4" aria-hidden />
        </ToolbarButton>
        <ToolbarButton
          label="Reducir sangría"
          onClick={() => {
            if (editor.isActive("listItem")) {
              editor.chain().focus().liftListItem("listItem").run();
              return;
            }
            const type = editor.isActive("heading") ? "heading" : "paragraph";
            const cur = (editor.getAttributes(type).indent as number) ?? 0;
            editor.chain().focus().updateAttributes(type, { indent: Math.max(0, cur - 1) }).run();
          }}
        >
          <IndentDecrease className="size-4" aria-hidden />
        </ToolbarButton>
        <ToolbarButton label="Cita destacada" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
          <TextQuote className="size-4" aria-hidden />
        </ToolbarButton>

        <Divider />

        <ToolbarButton label="Enlace" active={editor.isActive("link")} onClick={setLink}>
          <Link2 className="size-4" aria-hidden />
        </ToolbarButton>
        <ToolbarButton label="Insertar imagen" onClick={onPickImage}>
          <ImagePlus className="size-4" aria-hidden />
        </ToolbarButton>

        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger
                aria-label="Tabla"
                onMouseDown={(e) => e.preventDefault()}
                className={cn(
                  "flex size-8 items-center justify-center rounded-md transition-colors",
                  inTable ? "bg-section-soft text-section-strong" : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                <Table2 className="size-4" aria-hidden />
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">Tabla</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
              <Table2 className="size-4" /> Insertar tabla 3×3
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!inTable} onSelect={() => editor.chain().focus().addRowAfter().run()}>
              <Rows3 className="size-4" /> Agregar fila
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!inTable} onSelect={() => editor.chain().focus().addColumnAfter().run()}>
              <Columns3 className="size-4" /> Agregar columna
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!inTable} onSelect={() => editor.chain().focus().deleteRow().run()}>
              <Minus className="size-4" /> Quitar fila
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!inTable} onSelect={() => editor.chain().focus().deleteColumn().run()}>
              <Minus className="size-4" /> Quitar columna
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!inTable} onSelect={() => editor.chain().focus().toggleHeaderRow().run()}>
              Alternar fila de encabezado
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" disabled={!inTable} onSelect={() => editor.chain().focus().deleteTable().run()}>
              <Trash2 className="size-4" /> Eliminar tabla
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Divider />

        <ToolbarButton label="Quitar formato" onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}>
          <RemoveFormatting className="size-4" aria-hidden />
        </ToolbarButton>
        <ToolbarButton label="Deshacer" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>
          <Undo2 className="size-4" aria-hidden />
        </ToolbarButton>
        <ToolbarButton label="Rehacer" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>
          <Redo2 className="size-4" aria-hidden />
        </ToolbarButton>
      </div>
    </TooltipProvider>
  );
}

// ─── Editor ──────────────────────────────────────────────────────────────────

export function RichTextEditor({
  value,
  onChange,
  placeholder = "Escribe aquí…",
  minHeight = 220,
  id,
  compact = false,
  allowImages = true,
}: {
  /** HTML (o markdown legado, que se convierte al abrir). */
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
  id?: string;
  /** Barra reducida (respuestas de alumno): sin títulos. */
  compact?: boolean;
  allowImages?: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const legacyMarkdown = !isHtmlContent(value) && value.trim() !== "";

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: false,
        code: false,
      }),
      Placeholder.configure({ placeholder }),
      Underline,
      TextStyle,
      Color,
      FontSize,
      Indent,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Link.configure({ openOnClick: false, autolink: true, protocols: ["http", "https", "mailto"] }),
      Image.configure({ inline: false, allowBase64: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      CellBackground,
      // Solo para ABRIR contenido legado en markdown; la salida siempre es HTML.
      ...(legacyMarkdown ? [Markdown.configure({ html: false })] : []),
    ],
    content: value,
    editorProps: {
      transformPastedHTML: stripFontsFromPastedHtml,
      handlePaste: (_view, event) => {
        if (!allowImages) return false;
        const items = Array.from(event.clipboardData?.items ?? []);
        const imageItem = items.find((i) => i.type.startsWith("image/"));
        // Si el portapapeles trae HTML (p. ej. Word), dejamos que pegue el HTML
        const hasHtml = items.some((i) => i.type === "text/html");
        if (!imageItem || hasHtml) return false;
        const file = imageItem.getAsFile();
        if (!file) return false;
        event.preventDefault();
        void insertImageFile(file);
        return true;
      },
      handleDrop: (_view, event) => {
        if (!allowImages) return false;
        const file = Array.from(event.dataTransfer?.files ?? []).find((f) => f.type.startsWith("image/"));
        if (!file) return false;
        event.preventDefault();
        void insertImageFile(file);
        return true;
      },
      attributes: {
        id: id ?? "",
        role: "textbox",
        "aria-multiline": "true",
        class: "rich-content outline-none px-3.5 py-3",
      },
    },
    onUpdate: ({ editor }) => {
      onChange(editor.isEmpty ? "" : editor.getHTML());
    },
  });

  const insertImageFile = useCallback(
    async (file: File) => {
      if (!editor) return;
      if (file.size > 5 * 1024 * 1024) {
        toast.error("La imagen no debe pesar más de 5 MB");
        return;
      }
      try {
        const src = await uploadEditorImage(file);
        editor.chain().focus().setImage({ src, alt: file.name }).run();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "No se pudo subir la imagen");
      }
    },
    [editor]
  );

  if (!editor) {
    return (
      <div
        className="animate-pulse rounded-lg border bg-secondary/40"
        style={{ minHeight: minHeight + 40 }}
        aria-hidden
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border bg-card transition-shadow focus-within:ring-2 focus-within:ring-ring">
      <Toolbar editor={editor} compact={compact} onPickImage={() => fileInputRef.current?.click()} />
      {allowImages && (
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void insertImageFile(f);
            e.target.value = "";
          }}
        />
      )}
      <div
        style={{ minHeight }}
        className="cursor-text text-[15px] leading-relaxed [&_.ProseMirror]:min-h-[inherit]"
        onClick={() => editor.chain().focus().run()}
      >
        <EditorContent editor={editor} style={{ minHeight }} />
      </div>
    </div>
  );
}
