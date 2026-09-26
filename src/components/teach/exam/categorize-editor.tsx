"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, CircleAlert, Plus, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { LiveRegion, useAnnouncer } from "@/components/exam/live-region";
import { PlaceDnd, groupColumns } from "@/components/student/place-kit";
import {
  MAX_CARDS,
  MAX_GROUPS,
  MIN_GROUPS,
  categorizeProblem,
  type CategorizeCard,
  type CategorizeConfig,
  type CategorizeGroup,
} from "@/lib/categorize";
import { newCategorizeId } from "@/lib/categorize-editor-value";
import { iconNumbers, imageItemName } from "@/lib/image-questions";
import { plural } from "@/lib/plural";
import { cn } from "@/lib/utils";
import { GroupColumn, cardDragId, groupDropId } from "./categorize-group";
import { HistoryButtons } from "./image-canvas-toolbar";
import { isTypingTarget, isUndoKey, useEditorHistory } from "./use-editor-history";
import { EMPTY_ICON, useIconUploads } from "./use-editor-icons";

/**
 * Editor de «Clasificar en grupos»: los grupos como columnas (de 2 a 6; el
 * nombre se escribe en la columna; quitar uno con tarjetas pide confirmación)
 * y, en cada uno, sus tarjetas de texto o ícono. Los íconos se suben como en
 * «arrastrar a la imagen»: solo el dibujo, con un nombre neutro y sin repetir
 * uno que ya está. Una tarjeta cambia de grupo arrastrándola o con su menú.
 * Cada cambio es un paso de Deshacer (lo que se escribe seguido en un nombre,
 * uno solo); abajo, lo que impediría guardar, en vivo.
 */

const DUPLICATE_TEXT = "Ya hay una tarjeta con ese texto: el alumno no las distinguiría";
const DUPLICATE_ICON = "Ya hay una tarjeta con ese ícono: el alumno no las distinguiría.";

const sameText = (a: string | undefined, b: string) => (a ?? "").trim().toLocaleLowerCase("es") === b.trim().toLocaleLowerCase("es");

export function CategorizeEditor({
  value,
  onChange,
  onBusyChange,
}: {
  value: CategorizeConfig;
  onChange: (value: CategorizeConfig) => void;
  /** Hay una subida en curso: mientras tanto no se guarda. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const history = useEditorHistory(value, onChange);
  const { set } = history;
  /** Grupo al que se sube un ícono. */
  const [uploading, setUploading] = useState<string | null>(null);
  /** Error de una subida. */
  const [error, setError] = useState<string | null>(null);
  /** Aviso de algo que no se hizo (repetido, vacío). */
  const [notice, setNotice] = useState<string | null>(null);
  /** Grupo con tarjetas que se quiere quitar (espera confirmación). */
  const [removing, setRemoving] = useState<CategorizeGroup | null>(null);
  /** Tarjeta que va en la mano y grupo donde caería. */
  const [dragging, setDragging] = useState<string | null>(null);
  const [hot, setHot] = useState<string | null>(null);
  const { live, announce } = useAnnouncer();
  const icons = useIconUploads();
  const rootRef = useRef<HTMLDivElement>(null);
  /** Qué enfocar tras el próximo render (lo que tenía el foco pudo desaparecer). */
  const focusNext = useRef<string | null>(null);

  useEffect(() => {
    onBusyChange?.(uploading !== null);
  }, [uploading, onBusyChange]);
  // Si el editor se cierra a media subida, «Guardar» no se queda deshabilitado
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);

  useEffect(() => {
    const selector = focusNext.current;
    if (!selector) return;
    focusNext.current = null;
    rootRef.current?.querySelector<HTMLElement>(selector)?.focus();
  });

  const { groups, cards } = value;
  const full = cards.length >= MAX_CARDS;
  const iconNo = iconNumbers(cards.map((k) => k.fileId));
  const nameOf = (k: CategorizeCard) => (k.kind === "text" ? `«${k.text ?? ""}»` : imageItemName(k, iconNo));
  const labelOf = (g: CategorizeGroup, i: number) => g.name.trim() || `Grupo ${i + 1}`;
  const labelById = (id: string) => {
    const i = groups.findIndex((g) => g.id === id);
    return i < 0 ? "" : labelOf(groups[i], i);
  };
  const problem = categorizeProblem(value);

  function warn(text: string) {
    setNotice(text);
    announce(text);
  }

  const textProblem = (text: string, except?: string) =>
    cards.some((k) => k.kind === "text" && k.id !== except && sameText(k.text, text)) ? DUPLICATE_TEXT : null;

  function addGroup() {
    if (groups.length >= MAX_GROUPS) return;
    const id = newCategorizeId("g", groups);
    set((v) => (v.groups.length >= MAX_GROUPS ? v : { ...v, groups: [...v.groups, { id, name: "" }] }));
    focusNext.current = `[data-group-name="${id}"]`;
    announce(`Grupo ${groups.length + 1} agregado: escribe su nombre`);
  }

  function removeGroup(g: CategorizeGroup) {
    const i = groups.findIndex((x) => x.id === g.id);
    const neighbor = groups[i - 1] ?? groups[i + 1];
    set((v) => ({ groups: v.groups.filter((x) => x.id !== g.id), cards: v.cards.filter((k) => k.groupId !== g.id) }));
    announce(`Grupo ${labelOf(g, i)} quitado`);
    focusNext.current = neighbor ? `[data-group-name="${neighbor.id}"]` : "[data-add-group]";
  }

  function addText(groupId: string, text: string) {
    if (full || textProblem(text)) return;
    set((v) =>
      v.cards.length >= MAX_CARDS ? v : { ...v, cards: [...v.cards, { id: newCategorizeId("c", v.cards), kind: "text", text, groupId }] }
    );
    setNotice(null);
    announce(`«${text}» agregada a ${labelById(groupId)}`);
  }

  async function addIcon(groupId: string, file: File) {
    if (uploading || full) return;
    setError(null);
    setNotice(null);
    setUploading(groupId);
    try {
      const uploaded = await icons.uploadNewIcon(
        file,
        cards.flatMap((k) => (k.kind === "icon" && k.fileId ? [k.fileId] : []))
      );
      if (uploaded === "empty") return warn(EMPTY_ICON);
      if (uploaded === "duplicate") return warn(DUPLICATE_ICON);
      // Mientras subía se pudo quitar el grupo (o llenar la pregunta): entonces no se agrega
      let added = false as boolean;
      set((v) => {
        if (v.cards.length >= MAX_CARDS || !v.groups.some((g) => g.id === groupId)) return v;
        added = true;
        const card: CategorizeCard = { id: newCategorizeId("c", v.cards), kind: "icon", fileId: uploaded.fileId, ratio: uploaded.ratio, groupId };
        return { ...v, cards: [...v.cards, card] };
      });
      if (added) announce(`Ícono agregado a ${labelById(groupId)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo subir el ícono");
    } finally {
      setUploading(null);
    }
  }

  function moveCard(cardId: string, groupId: string, keyboard: boolean) {
    const card = cards.find((k) => k.id === cardId);
    if (!card || card.groupId === groupId) return;
    // Al final de su grupo nuevo
    set((v) => {
      const k = v.cards.find((x) => x.id === cardId);
      return k ? { ...v, cards: [...v.cards.filter((x) => x.id !== cardId), { ...k, groupId }] } : v;
    });
    announce(`${nameOf(card)} pasó a ${labelById(groupId)}`);
    if (keyboard) focusNext.current = `[data-card-menu="${cardId}"]`;
  }

  function removeCard(cardId: string) {
    const card = cards.find((k) => k.id === cardId);
    if (!card) return;
    const inGroup = cards.filter((k) => k.groupId === card.groupId);
    const j = inGroup.findIndex((k) => k.id === cardId);
    const neighbor = inGroup[j + 1] ?? inGroup[j - 1];
    set((v) => ({ ...v, cards: v.cards.filter((k) => k.id !== cardId) }));
    announce(`${nameOf(card)} quitada`);
    focusNext.current = neighbor ? `[data-card-remove="${neighbor.id}"]` : `[data-add-text="${card.groupId}"]`;
  }

  function editText(cardId: string, text: string) {
    if (textProblem(text, cardId)) return;
    set((v) => ({ ...v, cards: v.cards.map((k) => (k.id === cardId && k.kind === "text" ? { ...k, text } : k)) }));
    announce(`Tarjeta cambiada a «${text}»`);
  }

  /** Deshacer o rehacer; si lo que tenía el foco desaparece, el foco se queda en el editor. */
  function travel(to: "undo" | "redo") {
    const root = rootRef.current;
    const done = to === "undo" ? history.undo() : history.redo();
    if (done) setNotice(null);
    announce(done ? (to === "undo" ? "Cambio deshecho" : "Cambio rehecho") : to === "undo" ? "Nada que deshacer" : "Nada que rehacer");
    requestAnimationFrame(() => {
      if (root && !root.contains(document.activeElement)) root.focus({ preventScroll: true });
    });
  }

  /** La tarjeta de un id de arrastre, o el grupo de un id de destino. */
  const fromDrag = <T extends { id: string }>(id: string | null, prefix: (x: string) => string, list: T[]) =>
    id === null ? undefined : list.find((x) => prefix(x.id) === id);
  const ghost = fromDrag(dragging, cardDragId, cards);

  return (
    <div
      ref={rootRef}
      // Enfocable solo por código: si lo enfocado desaparece al deshacer, los atajos siguen aquí
      tabIndex={-1}
      role="group"
      aria-label="Grupos y tarjetas de la pregunta"
      className="grid gap-3 outline-none"
      onKeyDown={(e) => {
        // Ctrl+Z deshace; Ctrl+Mayús+Z o Ctrl+Y rehacen. En un campo de texto, el suyo
        if (!isUndoKey(e) || isTypingTarget(e.target)) return;
        e.preventDefault();
        travel(e.key.toLowerCase() === "y" || e.shiftKey ? "redo" : "undo");
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" data-add-group="" disabled={groups.length >= MAX_GROUPS} onClick={addGroup}>
          <Plus aria-hidden />
          Grupo
        </Button>
        <HistoryButtons
          canUndo={history.canUndo}
          canRedo={history.canRedo}
          onUndo={() => travel("undo")}
          onRedo={() => travel("redo")}
        />
        <span className="ms-auto text-xs tabular-nums text-muted-foreground">
          {groups.length} {plural(groups.length, "grupo", "grupos")} · {cards.length} de {MAX_CARDS} tarjetas
        </span>
      </div>
      <p className="-mt-1 text-xs text-muted-foreground">
        Agrega cada tarjeta en su grupo. Para cambiarla de grupo, arrástrala o usa su menú (▾). El alumno las verá revueltas.
      </p>

      <PlaceDnd
        ghost={ghost ?? null}
        onStart={(id) => {
          setNotice(null);
          setDragging(id);
        }}
        onOver={setHot}
        onDrop={(id, target) => {
          setDragging(null);
          setHot(null);
          const card = fromDrag(id, cardDragId, cards);
          const group = fromDrag(target, groupDropId, groups);
          if (card && group) moveCard(card.id, group.id, false);
        }}
        onCancel={() => {
          setDragging(null);
          setHot(null);
        }}
      >
        <div className={cn("grid gap-2.5", groupColumns(groups.length))}>
          {groups.map((g, i) => {
            const label = labelOf(g, i);
            return (
              <GroupColumn
                key={g.id}
                group={g}
                index={i}
                label={label}
                cards={cards.filter((k) => k.groupId === g.id)}
                others={groups.flatMap((x, j) => (x.id === g.id ? [] : [{ id: x.id, label: labelOf(x, j) }]))}
                nameOf={nameOf}
                canRemove={groups.length > MIN_GROUPS}
                hot={hot === groupDropId(g.id)}
                dragging={dragging && ghost ? ghost.id : null}
                uploading={uploading === g.id}
                busy={uploading !== null}
                full={full}
                textProblem={textProblem}
                onRename={(name) => set((v) => ({ ...v, groups: v.groups.map((x) => (x.id === g.id ? { ...x, name } : x)) }), { coalesce: `name:${g.id}` })}
                onRenameDone={history.commit}
                onRemove={() => (cards.some((k) => k.groupId === g.id) ? setRemoving(g) : removeGroup(g))}
                onAddText={(text) => addText(g.id, text)}
                onIconFile={(file) => void addIcon(g.id, file)}
                onMove={(cardId, groupId) => moveCard(cardId, groupId, true)}
                onRemoveCard={removeCard}
                onEditText={editText}
              />
            );
          })}
        </div>
      </PlaceDnd>

      {error && (
        <p className="flex items-center gap-1.5 text-sm text-destructive" role="alert">
          <TriangleAlert className="size-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}
      {notice && (
        <p className="flex items-center gap-1.5 text-sm text-amber-700 dark:text-warning" role="status">
          <CircleAlert className="size-4 shrink-0" aria-hidden />
          {notice}
        </p>
      )}
      {/* Lo que impediría guardar, en vivo */}
      <p className={cn("flex items-center gap-1.5 text-xs", problem ? "text-muted-foreground" : "text-success")}>
        {problem ? <CircleAlert className="size-3.5 shrink-0" aria-hidden /> : <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />}
        {problem ?? "Lista para guardar"}
      </p>
      <LiveRegion live={live} />

      <AlertDialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Quitar el grupo {removing ? labelById(removing.id) : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              {removing
                ? (() => {
                    const n = cards.filter((k) => k.groupId === removing.id).length;
                    return `${plural(n, "También se quita su tarjeta", `También se quitan sus ${n} tarjetas`)}. Puedes deshacerlo con Deshacer.`;
                  })()
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (removing) removeGroup(removing);
                setRemoving(null);
              }}
            >
              Quitar grupo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
