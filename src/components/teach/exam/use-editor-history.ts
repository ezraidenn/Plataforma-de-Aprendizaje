"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

/**
 * Deshacer y rehacer del editor abierto (la foto y su config). Cada cambio que
 * pasa por `set` es un paso, hasta HISTORY_LIMIT. Un gesto entero (arrastrar
 * un deslizante) es un solo paso: `begin()` al empezar y `commit()` al soltar;
 * `cancel()` lo deja como estaba antes de empezar, sin paso.
 * Cambios seguidos con la misma clave `coalesce` (escribir en un campo, pulsar
 * flechas) también se juntan en uno; `commit()` corta esa racha. Los cambios
 * `silent` (medir la foto, darle su forma al valor) no son pasos.
 *
 * `set` calcula el valor nuevo sobre el último que salió de aquí, así varios
 * cambios en el mismo evento (o al terminar una subida) no se pisan; lo
 * devuelve. Deshacer y rehacer llaman a `onChange` con el valor guardado.
 */

export const HISTORY_LIMIT = 100;

export type HistoryOptions = {
  /** Se junta con el cambio anterior si trae la misma clave. */
  coalesce?: string;
  /** No es un paso: arreglos automáticos que el maestro no hizo. */
  silent?: boolean;
};

export type EditorHistory<T> = {
  set: (next: T | ((prev: T) => T), options?: HistoryOptions) => T;
  undo: () => boolean;
  redo: () => boolean;
  begin: () => void;
  commit: () => void;
  cancel: () => void;
  canUndo: boolean;
  canRedo: boolean;
};

export function useEditorHistory<T>(value: T, onChange: (v: T) => void): EditorHistory<T> {
  /** El valor más nuevo (puede ir un render adelante de `value`). */
  const latest = useRef(value);
  /** El último `value` visto: si llega otro, cambió desde fuera y manda él. */
  const seen = useRef(value);
  const emit = useRef(onChange);
  const stacks = useRef<{ past: T[]; future: T[] }>({ past: [], future: [] });
  /** Clave del último cambio, para juntar los seguidos. */
  const run = useRef<string | null>(null);
  /** Gesto abierto: el valor de antes de empezar. */
  const gesture = useRef<{ base: T } | null>(null);
  const [counts, setCounts] = useState({ past: 0, future: 0 });

  useLayoutEffect(() => {
    emit.current = onChange;
    if (value !== seen.current) {
      seen.current = value;
      latest.current = value;
    }
  });

  const sync = useCallback(() => {
    const { past, future } = stacks.current;
    setCounts((c) => (c.past === past.length && c.future === future.length ? c : { past: past.length, future: future.length }));
  }, []);

  const push = useCallback((snapshot: T) => {
    stacks.current = { past: [...stacks.current.past, snapshot].slice(-HISTORY_LIMIT), future: [] };
  }, []);

  const set = useCallback(
    (next: T | ((prev: T) => T), options: HistoryOptions = {}): T => {
      const prev = latest.current;
      const value = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
      if (Object.is(value, prev)) return prev;
      latest.current = value;
      if (!options.silent && !gesture.current) {
        const key = options.coalesce ?? null;
        if (key === null || key !== run.current) push(prev);
        else stacks.current = { ...stacks.current, future: [] };
        run.current = key;
        sync();
      }
      emit.current(value);
      return value;
    },
    [push, sync]
  );

  const begin = useCallback(() => {
    if (gesture.current) return;
    gesture.current = { base: latest.current };
    run.current = null;
  }, []);

  const commit = useCallback(() => {
    const open = gesture.current;
    gesture.current = null;
    run.current = null;
    if (open && !Object.is(open.base, latest.current)) {
      push(open.base);
      sync();
    }
  }, [push, sync]);

  /** Deja todo como antes del gesto abierto (Esc a medio estirar), sin paso. Sin gesto, nada. */
  const cancel = useCallback(() => {
    const open = gesture.current;
    gesture.current = null;
    run.current = null;
    if (!open || Object.is(open.base, latest.current)) return;
    latest.current = open.base;
    emit.current(open.base);
  }, []);

  const travel = useCallback(
    (from: "past" | "future"): boolean => {
      commit();
      const { past, future } = stacks.current;
      const source = from === "past" ? past : future;
      if (source.length === 0) return false;
      const target = from === "past" ? past[past.length - 1] : future[0];
      stacks.current =
        from === "past"
          ? { past: past.slice(0, -1), future: [latest.current, ...future].slice(0, HISTORY_LIMIT) }
          : { past: [...past, latest.current].slice(-HISTORY_LIMIT), future: future.slice(1) };
      latest.current = target;
      sync();
      emit.current(target);
      return true;
    },
    [commit, sync]
  );
  const undo = useCallback(() => travel("past"), [travel]);
  const redo = useCallback(() => travel("future"), [travel]);

  return useMemo(
    () => ({ set, undo, redo, begin, commit, cancel, canUndo: counts.past > 0, canRedo: counts.future > 0 }),
    [set, undo, redo, begin, commit, cancel, counts]
  );
}

/** Ctrl+Z, Ctrl+Mayús+Z o Ctrl+Y (Cmd en Mac): deshacer o rehacer. */
export function isUndoKey(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): boolean {
  return (e.ctrlKey || e.metaKey) && !e.altKey && (e.key.toLowerCase() === "z" || e.key.toLowerCase() === "y");
}

/**
 * Ctrl+A o Ctrl+D (seleccionar todos los lugares, duplicar): mientras se
 * recorta la foto no hacen nada, y tampoco lo del navegador (seleccionar toda
 * la página, que luego se arrastraría en lugar del tirador; guardar un marcador).
 * Donde se escribe siguen siendo del campo (Ctrl+A selecciona su texto).
 */
export function blockEditorShortcut(e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  target: EventTarget | null;
  preventDefault: () => void;
}): void {
  if (isTypingTarget(e.target)) return;
  if ((e.ctrlKey || e.metaKey) && !e.altKey && /^[ad]$/i.test(e.key)) e.preventDefault();
}

const TEXT_INPUTS = new Set([
  "text",
  "search",
  "email",
  "number",
  "password",
  "tel",
  "url",
  "date",
  "datetime-local",
  "month",
  "time",
  "week",
]);

/**
 * El foco está donde se escribe (un campo de texto, un área o algo editable):
 * ahí los atajos del editor no actúan y el campo conserva los suyos (su propio
 * deshacer, seleccionar todo, borrar). Un deslizante o una casilla no cuentan.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && TEXT_INPUTS.has(target.type);
}
