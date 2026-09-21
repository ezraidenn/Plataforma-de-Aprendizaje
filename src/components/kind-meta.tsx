import {
  AlignLeft,
  FileQuestion,
  FileText,
  Folder,
  Link2,
  Play,
  Upload,
  FolderDown,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Sistema de color por TIPO de contenido (identidad, no estado).
 *
 * Regla inquebrantable: el color de tipo SIEMPRE acompaña al icono del tipo —
 * nunca color solo. Los semánticos (verde completado, ámbar advertencia, rojo
 * error, candado gris) y el café de marca (botones, navegación) no se tocan.
 * Los tokens viven en globals.css y están validados para daltonismo.
 *
 * Sin "use client": solo datos y JSX puro, importable desde server y client
 * components por igual.
 */

export type ContentKind =
  | "folder"
  | "document"
  | "video"
  | "text"
  | "exam"
  | "assignment"
  | "resource"
  | "link";

export type KindMeta = {
  label: string;
  Icon: LucideIcon;
  /** Color pleno del tipo, para el icono (text-*). */
  textClass: string;
  /** Fondo suave del tipo, para chips (bg-*-tint). */
  tintClass: string;
  /** Acento de borde izquierdo (border-l-*), para filas de lección. */
  borderClass: string;
};

export const KIND_META: Record<ContentKind, KindMeta> = {
  folder: {
    label: "Carpeta",
    Icon: Folder,
    textClass: "text-primary",
    tintClass: "bg-brand-tint",
    borderClass: "border-l-primary",
  },
  document: {
    label: "Documento",
    Icon: FileText,
    textClass: "text-kind-document",
    tintClass: "bg-kind-document-tint",
    borderClass: "border-l-kind-document",
  },
  text: {
    label: "Lectura",
    Icon: AlignLeft,
    textClass: "text-kind-text",
    tintClass: "bg-kind-text-tint",
    borderClass: "border-l-kind-text",
  },
  video: {
    label: "Video",
    Icon: Play,
    textClass: "text-kind-video",
    tintClass: "bg-kind-video-tint",
    borderClass: "border-l-kind-video",
  },
  exam: {
    label: "Examen",
    Icon: FileQuestion,
    textClass: "text-kind-exam",
    tintClass: "bg-kind-exam-tint",
    borderClass: "border-l-kind-exam",
  },
  assignment: {
    label: "Tarea",
    Icon: Upload,
    textClass: "text-kind-assignment",
    tintClass: "bg-kind-assignment-tint",
    borderClass: "border-l-kind-assignment",
  },
  resource: {
    label: "Recurso descargable",
    Icon: FolderDown,
    textClass: "text-kind-resource",
    tintClass: "bg-kind-resource-tint",
    borderClass: "border-l-kind-resource",
  },
  link: {
    label: "Enlace externo",
    Icon: Link2,
    textClass: "text-kind-link",
    tintClass: "bg-kind-link-tint",
    borderClass: "border-l-kind-link",
  },
};

/** Lookup tolerante: un kind desconocido cae en el neutro café (Lectura). */
export function kindMeta(kind: string): KindMeta {
  return KIND_META[kind as ContentKind] ?? KIND_META.text;
}

const CHIP_SIZES = {
  sm: { box: "size-6 rounded-md", icon: "size-3.5" },
  md: { box: "size-8 rounded-lg", icon: "size-4" },
  lg: { box: "size-10 rounded-xl", icon: "size-5" },
} as const;

/**
 * Chip de tipo: el icono del tipo dentro de un cuadradito redondeado con su
 * tinte (el patrón chip de la app). Icono + color siempre juntos; incluye el
 * nombre del tipo para lectores de pantalla.
 */
export function KindChip({
  kind,
  size = "sm",
  className,
}: {
  kind: string;
  size?: keyof typeof CHIP_SIZES;
  className?: string;
}) {
  const meta = kindMeta(kind);
  const sizes = CHIP_SIZES[size];
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center",
        sizes.box,
        meta.tintClass,
        meta.textClass,
        className
      )}
      title={meta.label}
    >
      <meta.Icon className={sizes.icon} aria-hidden />
      <span className="sr-only">{meta.label}</span>
    </span>
  );
}
