import Link from "next/link";
import { LogOut } from "lucide-react";
import type { SessionUser } from "@/server/auth/sessions";
import { logoutAction } from "@/server/auth/actions";
import { getBranding } from "@/server/services/branding";
import { gradingQueue } from "@/server/services/grading";
import { renewalCounts } from "@/server/services/renewals";
import { ownScope } from "@/server/auth/view-scope";
import { getViewScope } from "@/server/auth/view-scope-cookie";
import { listViewContextOptions, viewContextInfo } from "@/server/services/view-context";
import { BrandLogo } from "./brand-logo";
import { NavLink, type NavIconName } from "./nav-link";
import { NotificationsBell } from "./notifications-bell";
import { SectionScope } from "./section-scope";
import { MobileNav, type MobileNavItem } from "./mobile-nav";
import type { SectionKey } from "./sections";
import { ViewContextProvider } from "./view-context";
import { ViewContextSwitcher } from "./view-context-switcher";
import { ViewContextStrip } from "./view-context-strip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { AssistantProvider } from "@/components/assistant/assistant-provider";
import { AssistantField } from "@/components/assistant/assistant-field";
import { AssistantButton } from "@/components/assistant/assistant-button";
import { AssistantPanel } from "@/components/assistant/assistant-panel";

type NavItem = { href: string; label: string; icon: NavIconName; section: SectionKey };

const STUDENT_NAV: NavItem[] = [
  { href: "/dashboard", label: "Inicio", icon: "House", section: "home" },
  { href: "/dashboard#cursos", label: "Mis cursos", icon: "BookOpen", section: "courses" },
  { href: "/dashboard#certificados", label: "Mis certificados", icon: "Award", section: "certificates" },
];

const TEACHER_NAV: NavItem[] = [
  { href: "/teach/dashboard", label: "Inicio", icon: "House", section: "home" },
  { href: "/teach/courses", label: "Mis cursos", icon: "BookOpen", section: "courses" },
  { href: "/teach/grading", label: "Por calificar", icon: "ClipboardCheck", section: "grading" },
  { href: "/teach/students", label: "Estudiantes", icon: "Users", section: "students" },
  { href: "/teach/groups", label: "Grupos", icon: "Layers", section: "students" },
  { href: "/teach/reports", label: "Reportes", icon: "BarChart3", section: "reports" },
  { href: "/teach/templates", label: "Certificados", icon: "FileBadge", section: "certificates" },
  { href: "/teach/renewals", label: "Vencimientos", icon: "CalendarClock", section: "renewals" },
];

const ADMIN_NAV: NavItem[] = [
  { href: "/admin/users", label: "Usuarios", icon: "UserCog", section: "admin" },
  { href: "/admin/courses", label: "Todos los cursos", icon: "Library", section: "admin" },
  { href: "/admin/settings", label: "Configuración", icon: "Settings", section: "admin" },
];

function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

const ROLE_LABELS = { admin: "Administrador", teacher: "Maestro", student: "Estudiante" };

export async function AppShell({
  user,
  children,
}: {
  user: SessionUser;
  children: React.ReactNode;
}) {
  const isStudent = user.role === "student";
  // Para el admin, «Mis cursos» pasa a «Cursos»: la lista sigue el contexto
  // elegido (no siempre son «suyos»)
  const mainNav = isStudent
    ? STUDENT_NAV
    : user.role === "admin"
      ? TEACHER_NAV.map((item) => (item.href === "/teach/courses" ? { ...item, label: "Cursos" } : item))
      : TEACHER_NAV;
  const homeHref = isStudent ? "/dashboard" : "/teach/dashboard";
  const branding = getBranding();
  // Números del menú: SIEMPRE lo propio, como las notificaciones (el admin no
  // recibe los pendientes de otros maestros aunque esté viendo su contenido)
  const pendingGrading = isStudent ? 0 : gradingQueue(ownScope(user)).length;
  // Informativo (no es notificación): certificados vencidos por atender
  const expiredCount = isStudent ? 0 : renewalCounts(ownScope(user)).expired;
  // Contexto de vista (solo admin): selector junto a la campana + franja
  const isAdmin = user.role === "admin";
  const context = isAdmin ? viewContextInfo(await getViewScope(user)) : ({ kind: "own" } as const);
  const contextOptions = isAdmin ? listViewContextOptions(user.id) : null;
  const badgeFor = (section: SectionKey) =>
    section === "grading" ? pendingGrading : section === "renewals" ? expiredCount : undefined;

  const ACCOUNT_NAV: NavItem[] = [
    { href: "/ajustes", label: "Ajustes", icon: "SlidersHorizontal", section: "settings" },
    { href: "/guia", label: "Guía de uso", icon: "CircleHelp", section: "settings" },
    ...(isStudent ? [] : [{ href: "/teach/ayuda", label: "Ayuda visual", icon: "Sparkles", section: "settings" } satisfies NavItem]),
  ];
  const withBadge = (items: NavItem[]): MobileNavItem[] =>
    items.map((i) => ({ ...i, badge: badgeFor(i.section) }));
  const mobileGroups = [
    { title: "Menú", items: withBadge(mainNav) },
    { title: "Cuenta", items: withBadge(ACCOUNT_NAV) },
    ...(user.role === "admin" ? [{ title: "Administración", items: withBadge(ADMIN_NAV) }] : []),
  ];

  return (
    <div className="min-h-dvh">
      {/* ─── Sidebar azul noche (v3) ───────────────────────────────────────── */}
      <aside className="fixed bottom-0 left-0 top-0 z-40 hidden w-60 flex-col bg-[linear-gradient(180deg,#0f172a_0%,#1e1b4b_100%)] text-slate-200 md:flex">
        <Link
          href={homeHref}
          className="flex h-16 items-center gap-3 border-b border-white/[0.08] px-4 transition-opacity hover:opacity-90"
        >
          <BrandLogo logoFileId={branding.logoFileId} size={34} />
          <span className="truncate font-heading text-[15px] font-bold text-white">
            {branding.platformName}
          </span>
        </Link>

        <nav aria-label="Navegación principal" className="flex-1 space-y-0.5 overflow-y-auto p-3">
          <p className="px-2.5 pb-1.5 pt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
            Menú
          </p>
          {mainNav.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              icon={item.icon}
              label={item.label}
              section={item.section}
              badge={badgeFor(item.section)}
            />
          ))}

          <p className="px-2.5 pb-1.5 pt-5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
            Cuenta
          </p>
          <NavLink href="/ajustes" icon="SlidersHorizontal" label="Ajustes" section="settings" />
          <NavLink href="/guia" icon="CircleHelp" label="Guía de uso" section="settings" />
          {!isStudent && <NavLink href="/teach/ayuda" icon="Sparkles" label="Ayuda visual" section="settings" />}

          {user.role === "admin" && (
            <>
              <p className="px-2.5 pb-1.5 pt-5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
                Administración
              </p>
              {ADMIN_NAV.map((item) => (
                <NavLink
                  key={item.href}
                  href={item.href}
                  icon={item.icon}
                  label={item.label}
                  section={item.section}
                />
              ))}
            </>
          )}
        </nav>

        {/* Usuario al pie del sidebar */}
        <div className="border-t border-white/[0.08] p-3">
          <DropdownMenu>
            <DropdownMenuTrigger
              className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-white/[0.06]"
              aria-label="Menú de usuario"
            >
              <Avatar className="size-9">
                <AvatarFallback className="bg-white/10 text-sm font-semibold text-white">
                  {initials(user.fullName)}
                </AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-white">
                  {user.fullName}
                </span>
                <span className="block truncate text-[11px] text-slate-400">
                  {ROLE_LABELS[user.role]}
                </span>
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="w-64">
              <DropdownMenuLabel>
                <div className="flex flex-col gap-1">
                  <span className="font-semibold">{user.fullName}</span>
                  <span className="text-xs font-normal text-muted-foreground">{user.email}</span>
                  <Badge variant="secondary" className="mt-1 w-fit text-[11px]">
                    {ROLE_LABELS[user.role]}
                  </Badge>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <form action={logoutAction}>
                <DropdownMenuItem asChild variant="destructive">
                  <button type="submit" className="w-full">
                    <LogOut className="size-4" aria-hidden />
                    Cerrar sesión
                  </button>
                </DropdownMenuItem>
              </form>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* El header es la barra de sección (SectionScope): color de la sección,
          campana en blanco y, en móvil, el logo a la izquierda. */}
      <main className="md:pl-60">
        <ViewContextProvider value={context}>
          <AssistantProvider>
            <SectionScope
              center={!isStudent ? <AssistantField /> : undefined}
              leading={
                <div className="flex items-center gap-1">
                  <MobileNav
                    brand={
                      <>
                        <BrandLogo logoFileId={branding.logoFileId} size={32} />
                        <span className="truncate font-heading text-[15px] font-bold">
                          {branding.platformName}
                        </span>
                      </>
                    }
                    groups={mobileGroups}
                    user={{ fullName: user.fullName, roleLabel: ROLE_LABELS[user.role], email: user.email }}
                    onLogout={logoutAction}
                  />
                  <Link href={homeHref} className="flex items-center gap-2" aria-label={branding.platformName}>
                    <BrandLogo logoFileId={branding.logoFileId} size={28} />
                  </Link>
                </div>
              }
              trailing={
                <>
                  {!isStudent && <AssistantButton />}
                  {contextOptions && (
                    <ViewContextSwitcher current={context} options={contextOptions} selfName={user.fullName} />
                  )}
                  <NotificationsBell tone="onColor" />
                </>
              }
            >
              <ViewContextStrip />
              <div className="mx-auto max-w-6xl p-4 md:p-6">{children}</div>
            </SectionScope>
            {/* Los alumnos no ven nada del asistente */}
            {!isStudent && <AssistantPanel />}
          </AssistantProvider>
        </ViewContextProvider>
      </main>
    </div>
  );
}
