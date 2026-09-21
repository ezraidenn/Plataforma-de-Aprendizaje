"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ListTree, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CourseTree } from "./course-tree";
import type { StudentTreeNode } from "./types";

const STORAGE_KEY = "focus-sidebar-collapsed";

/**
 * Sidebar del Focus Mode (280px): árbol del curso con el ítem actual
 * resaltado. Colapsable en escritorio (estado persistido) y drawer en móvil.
 */
export function FocusSidebar({
  nodes,
  currentItemId,
}: {
  nodes: StudentTreeNode[];
  currentItemId: string;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [toggleSlot, setToggleSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setToggleSlot(document.getElementById("focus-mobile-toggle"));
  }, []);

  // localStorage solo tras montar (evita desajustes de hidratación)
  useEffect(() => {
    setCollapsed(window.localStorage.getItem(STORAGE_KEY) === "1");
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      window.localStorage.setItem(STORAGE_KEY, prev ? "0" : "1");
      return !prev;
    });
  };

  // Cerrar el drawer móvil al navegar a otro ítem
  useEffect(() => {
    setMobileOpen(false);
  }, [currentItemId]);

  const tree = <CourseTree nodes={nodes} currentItemId={currentItemId} dense />;

  return (
    <>
      {/* Escritorio */}
      <aside
        className={cn(
          "hidden shrink-0 flex-col border-r bg-card md:flex",
          collapsed ? "w-12" : "w-70"
        )}
        aria-label="Contenido del curso"
      >
        <div
          className={cn(
            "flex h-11 shrink-0 items-center border-b px-2",
            collapsed ? "justify-center" : "justify-between"
          )}
        >
          {!collapsed && (
            <p className="flex items-center gap-2 px-1.5 font-heading text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <span className="flex size-6 items-center justify-center rounded-md bg-brand-tint text-primary">
                <ListTree className="size-3.5" aria-hidden />
              </span>
              Contenido
            </p>
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-label={collapsed ? "Mostrar el contenido del curso" : "Ocultar el contenido del curso"}
            aria-expanded={!collapsed}
            onClick={toggleCollapsed}
          >
            {collapsed ? <PanelLeftOpen aria-hidden /> : <PanelLeftClose aria-hidden />}
          </Button>
        </div>
        {!collapsed && (
          <div className="flex-1 overflow-y-auto p-2 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200">
            {tree}
          </div>
        )}
      </aside>

      {/* Móvil: el botón vive en el header (portal) para no tapar la barra inferior */}
      {toggleSlot &&
        createPortal(
          <Button
            variant="ghost"
            size="icon"
            className="size-10 text-white hover:bg-white/15 hover:text-white"
            aria-label="Ver el contenido del curso"
            onClick={() => setMobileOpen(true)}
          >
            <ListTree aria-hidden />
          </Button>,
          toggleSlot
        )}

      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Contenido del curso">
          <button
            type="button"
            className="absolute inset-0 bg-foreground/40 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200"
            aria-label="Cerrar el contenido del curso"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-[85%] max-w-80 flex-col bg-card shadow-xl motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-left-8 motion-safe:duration-200">
            <div className="flex h-14 shrink-0 items-center justify-between border-b px-3">
              <p className="flex items-center gap-2 font-heading text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <span className="flex size-6 items-center justify-center rounded-md bg-brand-tint text-primary">
                  <ListTree className="size-3.5" aria-hidden />
                </span>
                Contenido
              </p>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Cerrar el contenido del curso"
                onClick={() => setMobileOpen(false)}
              >
                <X aria-hidden />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">{tree}</div>
          </div>
        </div>
      )}
    </>
  );
}
