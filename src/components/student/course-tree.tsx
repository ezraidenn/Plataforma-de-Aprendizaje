"use client";

import Link from "next/link";
import { Circle, CircleCheck, CircleDot, Folder, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { kindMeta } from "@/components/kind-meta";
import type { StudentTreeNode } from "./types";

/** Icono de estado según el léxico único de DISENO-UX §3.1. */
function StateIcon({ status }: { status: StudentTreeNode["status"] }) {
  switch (status) {
    case "completed":
      return (
        <CircleCheck className="size-5 shrink-0 fill-progress-ring stroke-white" aria-hidden />
      );
    case "in_progress":
      return <CircleDot className="size-5 shrink-0 text-primary" aria-hidden />;
    case "locked":
      return <Lock className="size-5 shrink-0 text-locked" aria-hidden />;
    default:
      return <Circle className="size-5 shrink-0 text-locked" aria-hidden />;
  }
}

const STATUS_LABELS: Record<StudentTreeNode["status"], string> = {
  completed: "Completado",
  in_progress: "En progreso",
  available: "Disponible",
  locked: "Bloqueado",
};

function ItemRow({
  node,
  current,
  dense,
}: {
  node: StudentTreeNode;
  current: boolean;
  dense: boolean;
}) {
  const meta = kindMeta(node.kind);

  const inner = (
    <>
      <StateIcon status={node.status} />
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate text-sm",
            node.status === "locked" ? "text-locked" : "text-foreground",
            current && "font-semibold"
          )}
        >
          {node.title}
        </span>
        {node.subtext && (
          <span className="block truncate text-xs text-muted-foreground">
            {node.subtext}
            {node.status === "in_progress" && node.percent > 0 && (
              <span className="text-primary"> · {node.percent}%</span>
            )}
          </span>
        )}
      </span>
      {node.comingSoon && (
        <Badge variant="secondary" className="shrink-0 text-[11px]">
          Próximamente
        </Badge>
      )}
      {/* Icono de TIPO en su color de identidad (bloqueado se mantiene gris) */}
      <meta.Icon
        className={cn(
          "size-3.5 shrink-0",
          node.status === "locked" ? "text-locked" : meta.textClass
        )}
        aria-hidden
      />
    </>
  );

  const rowClass = cn(
    "flex min-h-11 w-full items-center gap-2.5 rounded-lg border-l-[3px] border-transparent px-2.5 py-1.5 text-left",
    dense ? "" : "sm:px-3",
    current && "border-primary bg-brand-tint"
  );

  // Bloqueado: no navegable, pero focusable con tooltip (hover Y focus)
  if (node.status === "locked") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            tabIndex={0}
            role="button"
            aria-disabled="true"
            aria-label={`${node.title} — bloqueado. Completa «${node.blockedByTitle ?? "la lección anterior"}» primero`}
            className={cn(rowClass, "cursor-not-allowed select-none")}
          >
            {inner}
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          Completa «{node.blockedByTitle ?? "la lección anterior"}» primero
        </TooltipContent>
      </Tooltip>
    );
  }

  // Próximamente o documento en preparación: visible pero sin navegación
  if (!node.href) {
    return (
      <div
        className={cn(rowClass, "cursor-default")}
        aria-label={`${node.title} — ${node.comingSoon ? "disponible próximamente" : "en preparación"}`}
      >
        {inner}
      </div>
    );
  }

  return (
    <Link
      href={node.href}
      aria-current={current ? "page" : undefined}
      aria-label={`${node.title} — ${STATUS_LABELS[node.status]}`}
      className={cn(rowClass, "transition-colors hover:bg-accent")}
    >
      {inner}
    </Link>
  );
}

/**
 * Árbol del curso del estudiante. Carpetas como encabezados de grupo con
 * hijos indentados; ítems con el léxico de estados de DISENO-UX §3.1.
 */
export function CourseTree({
  nodes,
  currentItemId,
  dense = false,
}: {
  nodes: StudentTreeNode[];
  currentItemId?: string;
  dense?: boolean;
}) {
  const renderLevel = (level: StudentTreeNode[], depth: number) => (
    <ul className={cn("space-y-0.5", depth > 0 && "border-l border-border/60 pl-3")}>
      {level.map((node, index) =>
        node.kind === "folder" ? (
          // Carpeta = encabezado de sección: fondo suave + separador arriba
          <li key={node.id} className={cn(index > 0 && "mt-2 border-t pt-2.5")}>
            <p className="mb-1 flex items-center gap-2 rounded-lg bg-secondary/50 px-2.5 py-1.5 font-heading text-xs font-semibold uppercase tracking-wide text-secondary-foreground">
              <Folder className="size-3.5 shrink-0 text-section-strong" aria-hidden />
              <span className="truncate">{node.title}</span>
            </p>
            {node.children.length > 0 ? (
              renderLevel(node.children, depth + 1)
            ) : (
              <p className="px-3 pb-1 text-xs text-muted-foreground/70">Sin lecciones aún</p>
            )}
          </li>
        ) : (
          <li key={node.id}>
            <ItemRow node={node} current={node.id === currentItemId} dense={dense} />
          </li>
        )
      )}
    </ul>
  );

  return (
    <TooltipProvider delayDuration={100}>
      <nav aria-label="Contenido del curso">{renderLevel(nodes, 0)}</nav>
    </TooltipProvider>
  );
}
