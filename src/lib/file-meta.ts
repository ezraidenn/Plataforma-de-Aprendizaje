import {
  File,
  FileArchive,
  FileAudio,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Presentation,
  type LucideIcon,
} from "lucide-react";

/** Bytes → "1.2 MB" / "340 KB" (es-MX, sin decimales para KB). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

function extOf(name: string): string {
  return name.toLowerCase().split(".").pop() ?? "";
}

/** Icono de Lucide según mime/extensión, para listas de archivos. */
export function fileIconFor(mimeType: string, name = ""): LucideIcon {
  const mime = mimeType.toLowerCase();
  const ext = extOf(name);
  if (mime.startsWith("image/")) return FileImage;
  if (mime.startsWith("video/")) return FileVideo;
  if (mime.startsWith("audio/")) return FileAudio;
  if (mime === "application/pdf" || ext === "pdf") return FileText;
  if (
    mime.includes("spreadsheet") ||
    mime.includes("excel") ||
    mime === "text/csv" ||
    ["xls", "xlsx", "csv"].includes(ext)
  ) {
    return FileSpreadsheet;
  }
  if (mime.includes("presentation") || mime.includes("powerpoint") || ["ppt", "pptx"].includes(ext)) {
    return Presentation;
  }
  if (
    mime.includes("zip") ||
    mime.includes("compressed") ||
    mime.includes("x-tar") ||
    ["zip", "rar", "7z", "gz", "tar"].includes(ext)
  ) {
    return FileArchive;
  }
  if (mime.startsWith("text/") || mime.includes("word") || ["doc", "docx", "txt", "md", "rtf"].includes(ext)) {
    return FileText;
  }
  return File;
}
