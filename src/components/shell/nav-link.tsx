"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import {
  House,
  BookOpen,
  Award,
  ClipboardCheck,
  Users,
  BarChart3,
  FileBadge,
  UserCog,
  Library,
  Settings,
  SlidersHorizontal,
  CircleHelp,
  CalendarClock,
  Layers,
  Sparkles,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { SectionKey } from "./sections";

const NAV_ICONS = {
  House,
  BookOpen,
  Award,
  ClipboardCheck,
  Users,
  BarChart3,
  FileBadge,
  UserCog,
  Library,
  Settings,
  SlidersHorizontal,
  CircleHelp,
  CalendarClock,
  Layers,
  Sparkles,
} as const;

export type NavIconName = keyof typeof NAV_ICONS;

/**
 * Ítem del sidebar oscuro (v3). `section` fija las CSS vars del color de su
 * sección en el propio enlace: el chip del icono se pinta de ese color y, al
 * estar activo, la barra lateral también. Así el menú es un mapa de colores
 * que coincide con la franja superior de cada pantalla.
 */
function NavIcon({ icon: Icon }: { icon: LucideIcon }) {
  const { pending } = useLinkStatus();
  return pending ? (
    <Loader2 className="size-4 animate-spin" aria-label="Cargando" />
  ) : (
    <Icon className="size-4" aria-hidden />
  );
}

export function NavLink({
  href,
  icon,
  label,
  section,
  badge,
}: {
  href: string;
  icon: NavIconName;
  label: string;
  section: SectionKey;
  badge?: number;
}) {
  const pathname = usePathname();
  const Icon = NAV_ICONS[icon];
  const base = href.split("#")[0];
  const hasHash = href.includes("#");
  const active = !hasHash && (pathname === base || pathname.startsWith(base + "/"));

  return (
    <Link
      href={href}
      data-section={section}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex h-10 items-center gap-3 rounded-lg px-2.5 text-[13.5px] font-medium transition-colors duration-150",
        active
          ? "bg-white/10 text-white"
          : "text-slate-300 hover:bg-white/[0.06] hover:text-white"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full transition-opacity duration-200",
          // Cuenta (Ajustes/Guía): icono blanco y amarillo suave al activarse
          section === "settings" ? "bg-amber-200" : "bg-section",
          active ? "opacity-100" : "opacity-0"
        )}
      />
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-md transition-transform duration-150",
          section === "settings"
            ? active
              ? "bg-amber-200 text-slate-900 shadow-sm"
              : "bg-white/[0.07] text-white group-hover:scale-105"
            : active
              ? "bg-section text-section-fg shadow-sm"
              : "bg-white/[0.07] text-section group-hover:scale-105"
        )}
      >
        <NavIcon icon={Icon} />
      </span>
      <span className="truncate">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="ml-auto rounded-full bg-warning px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </Link>
  );
}
