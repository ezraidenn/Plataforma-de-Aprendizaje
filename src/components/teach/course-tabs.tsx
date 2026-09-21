"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import {
  ChartColumn,
  FolderTree,
  ListChecks,
  Settings,
  Users,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const TABS: { segment: string; label: string; icon: LucideIcon }[] = [
  { segment: "content", label: "Contenido", icon: FolderTree },
  { segment: "students", label: "Estudiantes", icon: Users },
  { segment: "stats", label: "Estadísticas", icon: ChartColumn },
  { segment: "rules", label: "Reglas de aprobación", icon: ListChecks },
  { segment: "settings", label: "Ajustes", icon: Settings },
];

/** Icono de la pestaña: muestra un spinner mientras la navegación está pendiente. */
function TabIcon({ icon: Icon, active }: { icon: LucideIcon; active: boolean }) {
  const { pending } = useLinkStatus();
  return (
    <span
      className={cn(
        "flex size-6 items-center justify-center rounded-md transition-colors",
        active
          ? "bg-section-soft text-section-strong"
          : "bg-secondary text-muted-foreground group-hover:text-foreground"
      )}
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" aria-label="Cargando" />
      ) : (
        <Icon className="size-3.5" aria-hidden />
      )}
    </span>
  );
}

/**
 * Pestañas del editor de curso: subrayado del color de la sección activa y
 * chip de icono que se tiñe cuando la pestaña está seleccionada.
 */
export function CourseTabs({ courseId }: { courseId: string }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Secciones del curso" className="border-b">
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {TABS.map((tab) => {
          const href = `/teach/courses/${courseId}/${tab.segment}`;
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={tab.segment} className="shrink-0">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group inline-flex h-11 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors",
                  active
                    ? "border-section text-section-strong"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                )}
              >
                <TabIcon icon={tab.icon} active={active} />
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
