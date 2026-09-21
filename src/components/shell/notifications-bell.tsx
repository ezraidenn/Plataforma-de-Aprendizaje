"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Award,
  BadgeCheck,
  Bell,
  BellOff,
  CalendarClock,
  ClipboardCheck,
  FileCheck,
  Megaphone,
  RotateCcw,
  Trash2,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  deleteAllNotificationsAction,
  deleteNotificationAction,
  getNotificationsAction,
  getUnreadCountAction,
  markAllReadAction,
  markReadAction,
  type NotificationDto,
} from "@/server/actions/notifications";

const POLL_MS = 60_000;

/** Icono por tipo (DISENO-UX §1.2). */
const TYPE_ICONS: Record<NotificationDto["type"], LucideIcon> = {
  certificate_issued: Award,
  course_completed: BadgeCheck,
  exam_needs_grading: ClipboardCheck,
  assignment_submitted: Upload,
  deadline_reminder: CalendarClock,
  submission_returned: RotateCcw,
  grade_published: FileCheck,
  results_available: Megaphone,
};

const OLD_DATE_FMT = new Intl.DateTimeFormat("es-MX", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** "hace 2 h" con el reloj del servidor como referencia. */
function relativeTime(ms: number, nowMs: number): string {
  const diff = Math.max(0, nowMs - ms);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "justo ahora";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "ayer";
  if (days < 30) return `hace ${days} días`;
  return OLD_DATE_FMT.format(new Date(ms));
}

/**
 * Campana del header (DISENO-UX §1.2): badge verde con no-leídas (máx "9+"),
 * popover de 380px con las últimas 15. Funciona para los tres roles: los
 * títulos y destinos ya vienen resueltos del server action.
 */
export function NotificationsBell({ tone = "light" }: { tone?: "light" | "onColor" }) {
  const router = useRouter();
  const onColor = tone === "onColor";
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationDto[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [confirmClear, setConfirmClear] = useState(false);

  // ─── Badge: al montar y cada 60 s, pausado con la pestaña oculta ──────────

  useEffect(() => {
    let interval: number | null = null;
    let cancelled = false;

    const tick = async () => {
      try {
        const n = await getUnreadCountAction();
        if (!cancelled) setUnread(n);
      } catch {
        // Silencioso: el badge se corrige en el siguiente ciclo
      }
    };
    const start = () => {
      if (interval === null) {
        interval = window.setInterval(() => void tick(), POLL_MS);
      }
    };
    const stop = () => {
      if (interval !== null) {
        window.clearInterval(interval);
        interval = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        stop();
      } else {
        void tick();
        start();
      }
    };

    void tick();
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // ─── Lista: se carga al abrir el popover ──────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await getNotificationsAction();
      setItems(res.items);
      setUnread(res.unread);
      setNowMs(res.serverNowMs);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    setConfirmClear(false);
    if (next) void load();
  };

  const handleItemClick = (n: NotificationDto) => {
    setOpen(false);
    if (n.read) {
      router.push(n.href);
      return;
    }
    // Optimista: el contador y el fondo se actualizan al instante. Se navega
    // cuando el servidor confirmó el «leído» (antes la navegación podía ganarle).
    setItems((prev) =>
      prev ? prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)) : prev
    );
    setUnread((u) => Math.max(0, u - 1));
    void markReadAction(n.id)
      .catch(() => {})
      .finally(() => router.push(n.href));
  };

  const handleDelete = (n: NotificationDto) => {
    setItems((prev) => (prev ? prev.filter((x) => x.id !== n.id) : prev));
    if (!n.read) setUnread((u) => Math.max(0, u - 1));
    void deleteNotificationAction(n.id)
      .then((res) => setUnread(res.unread))
      .catch(() => void load());
  };

  const handleClearAll = () => {
    setConfirmClear(false);
    setItems([]);
    setUnread(0);
    void deleteAllNotificationsAction().catch(() => void load());
  };

  const handleMarkAll = () => {
    setItems((prev) => (prev ? prev.map((x) => ({ ...x, read: true })) : prev));
    setUnread(0);
    void markAllReadAction().catch(() => {});
  };

  // Número exacto (hasta 99): así se ve bajar al leer una notificación
  const badgeText = unread > 99 ? "99+" : String(unread);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        className={cn(
          "relative flex size-11 items-center justify-center rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-offset-2",
          onColor
            ? "text-white hover:bg-white/15 focus-visible:outline-white"
            : "hover:bg-accent focus-visible:outline-primary"
        )}
        aria-label={
          unread > 0 ? `Notificaciones, ${unread} sin leer` : "Notificaciones"
        }
      >
        <Bell className="size-5" aria-hidden />
        {unread > 0 && (
          <span
            key={unread}
            aria-hidden
            className={cn(
              "absolute right-0.5 top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:duration-200",
              onColor
                ? "bg-white text-section-strong shadow-sm ring-2 ring-[var(--section)]"
                : "bg-cta text-cta-foreground"
            )}
          >
            {badgeText}
          </span>
        )}
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[380px] max-w-[calc(100vw-1rem)] gap-0 p-0"
      >
        {/* Encabezado */}
        <div className="flex min-h-12 items-center justify-between gap-2 border-b px-4 py-2.5">
          {confirmClear ? (
            <>
              <p className="text-sm font-medium">¿Borrar todas las notificaciones?</p>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleClearAll}
                  className="rounded-md bg-destructive px-2.5 py-1 text-xs font-semibold text-white hover:bg-destructive/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-destructive"
                >
                  Borrar todas
                </button>
              </div>
            </>
          ) : (
            <>
              <h2 className="font-heading text-sm font-semibold">Notificaciones</h2>
              <div className="flex shrink-0 items-center gap-3">
                {unread > 0 && items !== null && (
                  <button
                    type="button"
                    onClick={handleMarkAll}
                    className="rounded text-xs font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    Marcar como leídas
                  </button>
                )}
                {items !== null && items.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setConfirmClear(true)}
                    className="flex items-center gap-1 rounded text-xs font-medium text-muted-foreground hover:text-destructive focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                    Borrar todas
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        {/* Lista */}
        {loading || (items === null && !failed) ? (
          <div className="space-y-3 p-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-start gap-3">
                <Skeleton className="size-8 shrink-0 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
            ))}
          </div>
        ) : failed ? (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              No se pudieron cargar las notificaciones. Revisa tu conexión con el
              servidor.
            </p>
            <button
              type="button"
              onClick={() => void load()}
              className="rounded text-sm font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              Reintentar
            </button>
          </div>
        ) : items === null || items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <BellOff className="size-8 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium">Sin notificaciones</p>
            <p className="text-xs text-muted-foreground">Aquí aparecerán las nuevas.</p>
          </div>
        ) : (
          <ul className="max-h-[420px] overflow-y-auto py-1">
            {items.map((n) => {
              const Icon = TYPE_ICONS[n.type] ?? Bell;
              return (
                <li key={n.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => handleItemClick(n)}
                    className={cn(
                      "flex w-full items-start gap-3 py-3 pl-4 pr-11 text-left transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary",
                      !n.read && "bg-accent/50"
                    )}
                  >
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                      <Icon className="size-4 text-primary" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "block text-sm leading-snug",
                          !n.read && "font-medium"
                        )}
                      >
                        {n.title}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {relativeTime(n.createdAtMs, nowMs)}
                      </span>
                    </span>
                    {!n.read && (
                      <span
                        className="mt-1.5 size-2 shrink-0 rounded-full bg-cta"
                        aria-hidden
                      />
                    )}
                  </button>
                  {/* Borrar: visible al pasar el cursor o con foco; siempre en pantallas táctiles */}
                  <button
                    type="button"
                    onClick={() => handleDelete(n)}
                    aria-label={`Borrar notificación: ${n.title}`}
                    title="Borrar"
                    className="absolute right-2 top-2.5 flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-primary group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
