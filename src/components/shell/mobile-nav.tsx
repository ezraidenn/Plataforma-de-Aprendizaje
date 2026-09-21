"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { LogOut, Menu } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { NavLink, type NavIconName } from "./nav-link";
import type { SectionKey } from "./sections";

export type MobileNavItem = {
  href: string;
  label: string;
  icon: NavIconName;
  section: SectionKey;
  badge?: number;
};

/**
 * Menú móvil: botón hamburguesa en la barra de sección que abre el mismo
 * menú del sidebar (mismo mapa de colores) como panel lateral. Se cierra solo
 * al navegar.
 */
export function MobileNav({
  brand,
  groups,
  user,
  onLogout,
}: {
  brand: React.ReactNode;
  groups: { title: string; items: MobileNavItem[] }[];
  user: { fullName: string; roleLabel: string; email: string };
  onLogout: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Cerrar al cambiar de ruta
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const initials =
    user.fullName
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0] ?? "")
      .join("")
      .toUpperCase() || "?";

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        aria-label="Abrir menú"
        className="flex size-9 items-center justify-center rounded-lg text-white transition-colors hover:bg-white/15 md:hidden"
      >
        <Menu className="size-5" aria-hidden />
      </SheetTrigger>
      <SheetContent
        side="left"
        className="w-72 border-0 bg-[linear-gradient(180deg,#0f172a_0%,#1e1b4b_100%)] p-0 text-slate-200 [&>button]:text-white"
      >
        <SheetHeader className="border-b border-white/[0.08] px-4 py-4 text-left">
          <SheetTitle className="flex items-center gap-3 text-white">{brand}</SheetTitle>
          <SheetDescription className="sr-only">Menú de navegación</SheetDescription>
        </SheetHeader>

        <nav aria-label="Navegación principal" className="flex-1 space-y-0.5 overflow-y-auto p-3">
          {groups.map((g) => (
            <div key={g.title}>
              <p className="px-2.5 pb-1.5 pt-3 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
                {g.title}
              </p>
              {g.items.map((item) => (
                <NavLink key={item.href} {...item} />
              ))}
            </div>
          ))}
        </nav>

        <div className="border-t border-white/[0.08] p-3">
          <div className="flex items-center gap-3 rounded-lg p-2">
            <Avatar className="size-9">
              <AvatarFallback className="bg-white/10 text-sm font-semibold text-white">
                {initials}
              </AvatarFallback>
            </Avatar>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-white">
                {user.fullName}
              </span>
              <span className="block truncate text-[11px] text-slate-400">{user.roleLabel}</span>
            </span>
          </div>
          <form action={onLogout}>
            <button
              type="submit"
              className="mt-1 flex h-10 w-full items-center gap-3 rounded-lg px-2.5 text-[13.5px] font-medium text-rose-300 transition-colors hover:bg-white/[0.06]"
            >
              <LogOut className="size-4" aria-hidden />
              Cerrar sesión
            </button>
          </form>
        </div>
      </SheetContent>
    </Sheet>
  );
}
