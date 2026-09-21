// Léxico visual único (DISENO-UX §3.1 y §2.11) compartido por la matriz
// de progreso y el Sheet de drill-down. Los TIPOS de contenido (icono, nombre
// y color) vienen del sistema compartido en @/components/kind-meta; aquí solo
// vive el léxico de ESTADOS (semánticos: no se tocan).

import {
  Circle,
  CircleCheck,
  CircleDot,
  Lock,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { KIND_META, type ContentKind } from "@/components/kind-meta";

export type ItemKind = ContentKind;

export type CellState = "completed" | "in_progress" | "available" | "locked" | "overdue";

export const STATE_META: Record<
  CellState,
  { icon: LucideIcon; className: string; label: string }
> = {
  completed: { icon: CircleCheck, className: "text-progress-ring", label: "Completado" },
  in_progress: { icon: CircleDot, className: "text-warning", label: "En progreso" },
  available: { icon: Circle, className: "text-locked", label: "Sin empezar" },
  locked: { icon: Lock, className: "text-locked", label: "Bloqueado" },
  overdue: { icon: TriangleAlert, className: "text-destructive", label: "Vencido" },
};

export const KIND_ICON: Record<ItemKind, LucideIcon> = {
  folder: KIND_META.folder.Icon,
  document: KIND_META.document.Icon,
  video: KIND_META.video.Icon,
  text: KIND_META.text.Icon,
  exam: KIND_META.exam.Icon,
  assignment: KIND_META.assignment.Icon,
  resource: KIND_META.resource.Icon,
  link: KIND_META.link.Icon,
};

export const KIND_LABEL: Record<ItemKind, string> = {
  folder: KIND_META.folder.label,
  document: KIND_META.document.label,
  video: KIND_META.video.label,
  text: KIND_META.text.label,
  exam: KIND_META.exam.label,
  assignment: KIND_META.assignment.label,
  resource: KIND_META.resource.label,
  link: KIND_META.link.label,
};
