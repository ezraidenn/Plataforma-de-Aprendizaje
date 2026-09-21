"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AlignLeft,
  Check,
  ChevronRight,
  Clock,
  EllipsisVertical,
  FileQuestion,
  FileText,
  Folder,
  FolderPlus,
  GripVertical,
  Loader2,
  Play,
  Plus,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { KindChip, kindMeta } from "@/components/kind-meta";
import { HelpTip } from "@/components/help/help-tip";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  createItemAction,
  deleteItemAction,
  moveItemAction,
} from "@/server/actions/teacher-tree";
import { OpenFromUrl } from "@/components/open-from-url";
import { clearUrlParam, useOpenDialogRequest } from "@/lib/open-dialog";

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type TreeItemKind = "folder" | "document" | "video" | "text" | "exam" | "assignment" | "resource" | "link";

export type TreeItem = {
  id: string;
  parentId: string | null;
  kind: TreeItemKind;
  title: string;
  children: TreeItem[];
};

export type DocStatus = {
  status: "pending" | "processing" | "ready" | "error";
  pageCount: number | null;
  hasFile: boolean;
};

type Row = {
  item: TreeItem;
  depth: number;
  parentId: string | null;
  /** Índice dentro de la lista completa de hermanos (incluyéndose). */
  siblingIndex: number;
  siblingCount: number;
};

type DropIndicator = {
  overId: string;
  type: "before" | "after" | "inside";
  invalid: boolean;
};

const NEW_TITLES: Partial<Record<TreeItemKind, string>> = {
  folder: "Nueva carpeta",
  document: "Nuevo documento",
  text: "Nueva lectura",
  video: "Nuevo video",
  exam: "Nuevo examen",
  assignment: "Nueva tarea",
  resource: "Nuevo recurso descargable",
  link: "Nuevo enlace externo",
};

const MAX_FOLDER_DEPTH = 2;

// ─── Utilidades de árbol (inmutables) ────────────────────────────────────────

function flatten(
  nodes: TreeItem[],
  collapsed: Set<string>,
  hiddenSubtree: string | null,
  depth = 0,
  parentId: string | null = null
): Row[] {
  const rows: Row[] = [];
  nodes.forEach((item, i) => {
    rows.push({ item, depth, parentId, siblingIndex: i, siblingCount: nodes.length });
    const hideChildren =
      collapsed.has(item.id) || item.id === hiddenSubtree || item.children.length === 0;
    if (!hideChildren) {
      rows.push(...flatten(item.children, collapsed, hiddenSubtree, depth + 1, item.id));
    }
  });
  return rows;
}

function findNode(nodes: TreeItem[], id: string): TreeItem | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const hit = findNode(node.children, id);
    if (hit) return hit;
  }
  return null;
}

function removeNode(nodes: TreeItem[], id: string): { tree: TreeItem[]; removed: TreeItem | null } {
  let removed: TreeItem | null = null;
  const walk = (list: TreeItem[]): TreeItem[] =>
    list
      .filter((n) => {
        if (n.id === id) {
          removed = n;
          return false;
        }
        return true;
      })
      .map((n) => ({ ...n, children: walk(n.children) }));
  return { tree: walk(nodes), removed };
}

function insertNode(
  nodes: TreeItem[],
  parentId: string | null,
  index: number,
  node: TreeItem
): TreeItem[] {
  if (parentId === null) {
    const copy = [...nodes];
    copy.splice(Math.max(0, Math.min(index, copy.length)), 0, { ...node, parentId: null });
    return copy;
  }
  return nodes.map((n) => {
    if (n.id === parentId) {
      const children = [...n.children];
      children.splice(Math.max(0, Math.min(index, children.length)), 0, {
        ...node,
        parentId,
      });
      return { ...n, children };
    }
    return { ...n, children: insertNode(n.children, parentId, index, node) };
  });
}

/** Profundidad de carpetas del padre destino (0 = raíz, 1 = dentro de carpeta raíz…). */
function folderDepthOf(nodes: TreeItem[], parentId: string | null): number {
  let depth = 0;
  let current = parentId;
  while (current) {
    const parent = findNode(nodes, current);
    if (!parent) break;
    depth += 1;
    current = parent.parentId;
  }
  return depth;
}

function hasSubfolders(item: TreeItem): boolean {
  return item.children.some((c) => c.kind === "folder");
}

function isDescendant(ancestor: TreeItem, id: string): boolean {
  return ancestor.children.some((c) => c.id === id || isDescendant(c, id));
}

// ─── Componente principal ────────────────────────────────────────────────────

export function TreeEditor({
  courseId,
  tree: serverTree,
  docStatus,
  selectedId,
}: {
  courseId: string;
  tree: TreeItem[];
  docStatus: Record<string, DocStatus>;
  selectedId: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [tree, setTree] = useState(serverTree);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropIndicator | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TreeItem | null>(null);
  // La guía de primeros pasos llega con ?agregar=1 y despliega el menú «Agregar»
  const [addOpen, setAddOpen] = useState(false);
  const [, startTransition] = useTransition();

  // Sincronizar con el servidor cuando llegan datos nuevos (patrón React de
  // "derived state"): el estado local solo existe para el reorden optimista.
  const serverTreeRef = useRef(serverTree);
  if (serverTreeRef.current !== serverTree) {
    serverTreeRef.current = serverTree;
    setTree(serverTree);
  }

  const rows = useMemo(
    () => flatten(tree, collapsed, activeId),
    [tree, collapsed, activeId]
  );
  const activeItem = activeId ? findNode(tree, activeId) : null;

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function select(id: string) {
    router.push(`${pathname}?item=${id}`, { scroll: false });
  }

  // ── Cálculo del destino del drag ──────────────────────────────────────────

  function computeDrop(event: DragMoveEvent): DropIndicator | null {
    const { active, over } = event;
    if (!over || over.id === active.id) return null;
    const overRow = rows.find((r) => r.item.id === over.id);
    const dragged = findNode(tree, String(active.id));
    if (!overRow || !dragged) return null;

    const translated = active.rect.current.translated;
    const centerY = translated ? translated.top + translated.height / 2 : over.rect.top;
    const rel = (centerY - over.rect.top) / over.rect.height;

    let type: DropIndicator["type"];
    if (overRow.item.kind === "folder" && rel >= 0.3 && rel <= 0.7) {
      type = "inside";
    } else {
      type = rel < 0.5 ? "before" : "after";
    }

    const targetParentId = type === "inside" ? overRow.item.id : overRow.parentId;

    // Nunca dentro de sí mismo ni de un descendiente
    let invalid =
      targetParentId === dragged.id ||
      (targetParentId !== null && isDescendant(dragged, targetParentId));

    // Máximo dos niveles de carpetas
    if (!invalid && dragged.kind === "folder") {
      const destDepth = folderDepthOf(tree, targetParentId);
      if (destDepth + 1 + (hasSubfolders(dragged) ? 1 : 0) > MAX_FOLDER_DEPTH) invalid = true;
    }

    return { overId: overRow.item.id, type, invalid };
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragMove(event: DragMoveEvent) {
    setDrop(computeDrop(event));
  }

  function handleDragEnd(event: DragEndEvent) {
    const dragged = activeId ? findNode(tree, activeId) : null;
    const finalDrop = drop;
    setActiveId(null);
    setDrop(null);
    if (!dragged || !finalDrop || !event.over) return;

    if (finalDrop.invalid) {
      toast.error("Máximo dos niveles de carpetas");
      return;
    }

    const overRow = rows.find((r) => r.item.id === finalDrop.overId);
    if (!overRow) return;

    let newParentId: string | null;
    let newIndex: number;

    if (finalDrop.type === "inside") {
      newParentId = overRow.item.id;
      const folder = findNode(tree, newParentId);
      newIndex = folder ? folder.children.filter((c) => c.id !== dragged.id).length : 0;
      setCollapsed((prev) => {
        const next = new Set(prev);
        next.delete(overRow.item.id);
        return next;
      });
    } else {
      newParentId = overRow.parentId;
      const siblings = (
        newParentId === null ? tree : findNode(tree, newParentId)?.children ?? []
      ).filter((c) => c.id !== dragged.id);
      const overIdx = siblings.findIndex((c) => c.id === overRow.item.id);
      newIndex = overIdx < 0 ? siblings.length : overIdx + (finalDrop.type === "after" ? 1 : 0);
    }

    applyMove(dragged, newParentId, newIndex);
  }

  /** Reorden optimista con rollback si el servidor rechaza el movimiento. */
  function applyMove(dragged: TreeItem, newParentId: string | null, newIndex: number) {
    const previous = tree;
    const { tree: without, removed } = removeNode(tree, dragged.id);
    if (!removed) return;
    setTree(insertNode(without, newParentId, newIndex, removed));

    startTransition(async () => {
      const result = await moveItemAction({
        courseId,
        itemId: dragged.id,
        newParentId,
        newIndex,
      });
      if ("error" in result) {
        setTree(previous);
        toast.error(result.error);
      } else {
        router.refresh();
      }
    });
  }

  // ── Alternativa accesible: subir / bajar por menú ─────────────────────────

  function moveByOffset(row: Row, delta: -1 | 1) {
    applyMove(row.item, row.parentId, row.siblingIndex + delta);
  }

  // ── Agregar y eliminar ────────────────────────────────────────────────────

  function addItem(kind: TreeItemKind) {
    // Se inserta en la carpeta seleccionada (o la carpeta del ítem seleccionado)
    const selected = selectedId ? findNode(tree, selectedId) : null;
    let parentId: string | null = null;
    if (selected) {
      parentId = selected.kind === "folder" ? selected.id : selected.parentId;
    }
    if (kind === "folder" && parentId !== null) {
      // Una carpeta nueva dentro de otra respeta el límite; si no cabe, va a la raíz
      if (folderDepthOf(tree, parentId) + 1 > MAX_FOLDER_DEPTH) parentId = null;
    }

    startTransition(async () => {
      const result = await createItemAction({
        courseId,
        parentId,
        kind,
        title: NEW_TITLES[kind] ?? "Nuevo elemento",
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      router.push(`${pathname}?item=${result.itemId}`, { scroll: false });
      router.refresh();
    });
  }

  function confirmDelete() {
    const target = deleteTarget;
    if (!target) return;
    setDeleteTarget(null);
    startTransition(async () => {
      const result = await deleteItemAction(courseId, target.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`Se eliminó «${target.title}»`);
      if (
        selectedId &&
        (selectedId === target.id || isDescendant(target, selectedId))
      ) {
        router.push(pathname, { scroll: false });
      }
      router.refresh();
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  // Con el curso vacío el menú visible es el grande del centro; si no, el del
  // encabezado. Solo ese responde a ?agregar=1 (si no, se abrirían dos).
  const empty = rows.length === 0 && !activeId;

  function handleAddOpenChange(next: boolean) {
    setAddOpen(next);
    if (!next) clearUrlParam("agregar");
  }

  function openAddMenu() {
    setAddOpen(true);
  }

  useOpenDialogRequest("add-item", openAddMenu);

  return (
    <div className="flex h-full min-h-80 flex-col rounded-xl border bg-card shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
      <OpenFromUrl param="agregar" onOpen={openAddMenu} />
      <div className="flex items-center justify-between border-b p-3">
        <p className="text-[11px] font-bold uppercase tracking-wider text-section-strong">
          Contenido del curso
        </p>
        <div className="flex items-center gap-1.5">
          <HelpTip topic="content.types" />
          <AddItemMenu onAdd={addItem} open={!empty && addOpen} onOpenChange={handleAddOpenChange} />
        </div>
      </div>

      {empty ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <span className="anim-pop flex size-16 items-center justify-center rounded-full bg-section-soft text-section-strong">
            <FolderPlus className="size-8" aria-hidden />
          </span>
          <p className="max-w-56 text-sm text-muted-foreground">
            Empieza agregando una carpeta o una lección
          </p>
          <AddItemMenu
            onAdd={addItem}
            primary
            open={empty && addOpen}
            onOpenChange={handleAddOpenChange}
          />
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          onDragCancel={() => {
            setActiveId(null);
            setDrop(null);
          }}
        >
          <SortableContext
            items={rows.map((r) => r.item.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul role="tree" aria-label="Árbol de contenido" className="flex-1 space-y-0.5 p-2">
              {rows.map((row) => (
                <TreeRow
                  key={row.item.id}
                  row={row}
                  selected={row.item.id === selectedId}
                  isDragging={row.item.id === activeId}
                  drop={drop?.overId === row.item.id ? drop : null}
                  collapsed={collapsed.has(row.item.id)}
                  docStatus={docStatus[row.item.id]}
                  onSelect={() => select(row.item.id)}
                  onToggle={() =>
                    setCollapsed((prev) => {
                      const next = new Set(prev);
                      if (next.has(row.item.id)) next.delete(row.item.id);
                      else next.add(row.item.id);
                      return next;
                    })
                  }
                  onMoveUp={row.siblingIndex > 0 ? () => moveByOffset(row, -1) : undefined}
                  onMoveDown={
                    row.siblingIndex < row.siblingCount - 1
                      ? () => moveByOffset(row, 1)
                      : undefined
                  }
                  onDelete={() => setDeleteTarget(row.item)}
                />
              ))}
            </ul>
          </SortableContext>

          <DragOverlay>
            {activeItem && (
              <div className="flex items-center gap-2 rounded-lg border bg-card px-2 py-1.5 text-sm shadow-md">
                <GripVertical className="size-4 text-muted-foreground" aria-hidden />
                <KindIcon kind={activeItem.kind} />
                <span className="max-w-64 truncate">{activeItem.title}</span>
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}

      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar «{deleteTarget?.title}»?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.kind === "folder"
                ? "Se eliminará la carpeta con todo su contenido. Esta acción no se puede deshacer."
                : "Esta acción no se puede deshacer."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={confirmDelete}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Fila del árbol ──────────────────────────────────────────────────────────

function TreeRow({
  row,
  selected,
  isDragging,
  drop,
  collapsed,
  docStatus,
  onSelect,
  onToggle,
  onMoveUp,
  onMoveDown,
  onDelete,
}: {
  row: Row;
  selected: boolean;
  isDragging: boolean;
  drop: DropIndicator | null;
  collapsed: boolean;
  docStatus: DocStatus | undefined;
  onSelect: () => void;
  onToggle: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: row.item.id,
  });
  const { item, depth } = row;
  const isFolder = item.kind === "folder";
  const lineColor = drop?.invalid ? "bg-destructive" : "bg-section";

  return (
    <li
      ref={setNodeRef}
      role="treeitem"
      aria-selected={selected}
      aria-expanded={isFolder ? !collapsed : undefined}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        paddingLeft: depth * 20,
      }}
      className={cn("relative", isDragging && "opacity-40")}
    >
      {drop?.type === "before" && (
        <span className={cn("absolute inset-x-1 -top-0.5 z-10 h-0.5 rounded", lineColor)} aria-hidden />
      )}
      {drop?.type === "after" && (
        <span className={cn("absolute inset-x-1 -bottom-0.5 z-10 h-0.5 rounded", lineColor)} aria-hidden />
      )}

      <div
        className={cn(
          "group relative flex items-center gap-1 rounded-lg border border-transparent px-1 py-1 transition-colors",
          // Lección: acento sutil de 2px del color de su tipo (acompaña al icono)
          !isFolder && !selected && cn("border-l-2", kindMeta(item.kind).borderClass),
          // Carpeta: fila destacada como "sección" (división neutra café)
          isFolder && !selected && drop?.type !== "inside" && "bg-secondary/50",
          // Seleccionado: fondo suave de la sección + barra izquierda del color de sección
          selected
            ? "bg-section-soft before:absolute before:inset-y-1 before:left-0 before:w-1 before:rounded-full before:bg-section"
            : "hover:bg-section-soft/50",
          drop?.type === "inside" &&
            (drop.invalid ? "bg-destructive/10 ring-1 ring-destructive" : "bg-section-soft ring-1 ring-section")
        )}
      >
        <button
          type="button"
          className="cursor-grab touch-none rounded p-1 text-locked transition-colors hover:bg-section-soft hover:text-section-strong"
          aria-label={`Arrastrar «${item.title}»`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" aria-hidden />
        </button>

        {isFolder ? (
          <button
            type="button"
            onClick={onToggle}
            className="rounded p-0.5 text-muted-foreground hover:bg-muted"
            aria-label={collapsed ? `Expandir «${item.title}»` : `Contraer «${item.title}»`}
          >
            <ChevronRight
              className={cn("size-4 transition-transform", !collapsed && "rotate-90")}
              aria-hidden
            />
          </button>
        ) : (
          <span className="w-5" aria-hidden />
        )}

        <button
          type="button"
          onClick={onSelect}
          className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-0.5 text-left text-sm transition-colors hover:text-section-strong"
        >
          <KindIcon kind={item.kind} />
          <span className={cn("truncate", isFolder && "font-semibold")}>{item.title}</span>
        </button>

        {item.kind === "document" && docStatus && <DocStatusIcon status={docStatus} />}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon-sm"
              variant="ghost"
              className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
              aria-label={`Opciones de «${item.title}»`}
            >
              <EllipsisVertical aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={!onMoveUp} onSelect={() => onMoveUp?.()}>
              Subir
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!onMoveDown} onSelect={() => onMoveDown?.()}>
              Bajar
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              Eliminar
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

function KindIcon({ kind }: { kind: TreeItemKind }) {
  const meta = kindMeta(kind);
  return <meta.Icon className={cn("size-4 shrink-0", meta.textClass)} aria-hidden />;
}

function DocStatusIcon({ status }: { status: DocStatus }) {
  if (!status.hasFile) return null;
  switch (status.status) {
    case "ready":
      return (
        <span title={status.pageCount ? `Listo · ${status.pageCount} páginas` : "Listo"}>
          <Check className="size-4 shrink-0 text-success" aria-label="Documento listo" />
        </span>
      );
    case "processing":
      return (
        <Loader2
          className="size-4 shrink-0 animate-spin text-section-strong"
          aria-label="Convirtiendo documento"
        />
      );
    case "error":
      return (
        <TriangleAlert
          className="size-4 shrink-0 text-destructive"
          aria-label="Error al procesar el documento"
        />
      );
    default:
      return (
        <Clock
          className="size-4 shrink-0 text-muted-foreground"
          aria-label="Documento en espera de conversión"
        />
      );
  }
}

// ─── Menú "+ Agregar" ────────────────────────────────────────────────────────

function AddItemMenu({
  onAdd,
  primary = false,
  open,
  onOpenChange,
}: {
  onAdd: (kind: TreeItemKind) => void;
  primary?: boolean;
  /** Controlado siempre: la guía lo abre con ?agregar=1 */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        {primary ? (
          <Button className="h-11 bg-cta px-4 text-cta-foreground hover:bg-cta/90">
            <Plus aria-hidden />
            Agregar
          </Button>
        ) : (
          <Button variant="outline" size="sm">
            <Plus aria-hidden />
            Agregar
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {/* Icono de cada tipo en su color de identidad (color + icono, nunca solo) */}
        <DropdownMenuItem onSelect={() => onAdd("folder")}>
          <Folder className="text-section-strong" aria-hidden />
          Carpeta
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAdd("document")}>
          <FileText className="text-kind-document" aria-hidden />
          Documento (PPT/PDF)
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAdd("text")}>
          <AlignLeft className="text-kind-text" aria-hidden />
          Lectura
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAdd("video")}>
          <Play className="text-kind-video" aria-hidden />
          Video por enlace
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAdd("exam")}>
          <FileQuestion className="text-kind-exam" aria-hidden />
          Examen
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAdd("assignment")}>
          <Upload className="text-kind-assignment" aria-hidden />
          Tarea
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onAdd("resource")}>
          <KindChip kind="resource" size="sm" className="-ml-1" />
          Recurso descargable
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAdd("link")}>
          <KindChip kind="link" size="sm" className="-ml-1" />
          Enlace externo
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
