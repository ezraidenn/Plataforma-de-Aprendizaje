import {
  CalendarClock,
  House,
  BookOpen,
  ClipboardCheck,
  Users,
  BarChart3,
  FileBadge,
  Settings,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";

/**
 * Secciones de la app (v3). Cada una tiene un color (CSS vars en globals.css
 * bajo [data-section=...]) que tiñe el menú, la cabecera y los acentos de la
 * pantalla: el usuario SIEMPRE sabe dónde está.
 */
export type SectionKey =
  | "home"
  | "courses"
  | "grading"
  | "students"
  | "renewals"
  | "reports"
  | "certificates"
  | "admin"
  | "settings"
  | "focus";

export const SECTION_META: Record<SectionKey, { label: string; Icon: LucideIcon }> = {
  home: { label: "Inicio", Icon: House },
  courses: { label: "Cursos", Icon: BookOpen },
  grading: { label: "Por calificar", Icon: ClipboardCheck },
  students: { label: "Estudiantes", Icon: Users },
  renewals: { label: "Vencimientos", Icon: CalendarClock },
  reports: { label: "Reportes", Icon: BarChart3 },
  certificates: { label: "Certificados", Icon: FileBadge },
  admin: { label: "Administración", Icon: Settings },
  settings: { label: "Ajustes", Icon: SlidersHorizontal },
  focus: { label: "Lección", Icon: BookOpen },
};

/** Deriva la sección desde la ruta (maestro, estudiante y admin). */
export function sectionFor(pathname: string): SectionKey {
  if (pathname.startsWith("/admin")) return "admin";
  if (pathname.startsWith("/ajustes") || pathname.startsWith("/guia")) return "settings";
  if (pathname.startsWith("/teach/grading")) return "grading";
  if (pathname.startsWith("/teach/students")) return "students";
  if (pathname.startsWith("/teach/groups")) return "students";
  if (pathname.startsWith("/teach/renewals")) return "renewals";
  if (pathname.startsWith("/teach/reports")) return "reports";
  if (pathname.startsWith("/teach/templates")) return "certificates";
  if (/^\/teach\/courses\/[^/]+\/stats/.test(pathname)) return "reports";
  if (pathname.startsWith("/teach/courses")) return "courses";
  if (pathname.startsWith("/teach/ayuda")) return "settings";
  if (pathname.startsWith("/teach")) return "home";
  if (/^\/courses\/[^/]+\/items\//.test(pathname)) return "focus";
  if (pathname.startsWith("/courses")) return "courses";
  return "home";
}
