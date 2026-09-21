"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { TriangleAlert, Wifi } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { KindChip } from "@/components/kind-meta";
import { sendVideoHeartbeat } from "./heartbeat";
import { StudyTimer, formatClock, type StudyTimerState } from "./study-timer";
import type { VideoLessonData } from "./types";

const HEARTBEAT_MS = 10_000;
// Tolerancia antes de considerar un salto como "adelantar" (segundos)
const SEEK_TOLERANCE_S = 2;
// Un tick de reproducción normal nunca salta más que esto (poll 1 s × 2x + margen)
const PLAYBACK_JUMP_S = 3.5;

// ─── Carga única de la IFrame API de YouTube ─────────────────────────────────

type YTPlayer = {
  getCurrentTime: () => number;
  getDuration: () => number;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getPlaybackRate: () => number;
  setPlaybackRate: (rate: number) => void;
  destroy: () => void;
};

type YTNamespace = {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId: string;
      width?: string;
      height?: string;
      playerVars?: Record<string, number>;
      events?: {
        onReady?: () => void;
        onStateChange?: (e: { data: number }) => void;
      };
    }
  ) => YTPlayer;
};

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytReadyPromise: Promise<void> | null = null;

function loadYouTubeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (!ytReadyPromise) {
    ytReadyPromise = new Promise<void>((resolve) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prev?.();
        resolve();
      };
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      document.head.appendChild(script);
    });
  }
  return ytReadyPromise;
}

/**
 * Player de video por enlace (YouTube/Vimeo) con tracking por latidos.
 * El cliente solo reporta la posición; el SERVIDOR acredita intervalos con su
 * reloj. Adelantar más allá de lo visto se bloquea; retroceder es libre.
 */
export function VideoPlayer({
  courseId,
  itemId,
  title,
  data,
  onCompleted,
}: {
  courseId: string;
  itemId: string;
  title: string;
  data: VideoLessonData;
  onCompleted: () => void;
}) {
  const [percent, setPercent] = useState(data.initialPercent);
  const [completed, setCompleted] = useState(data.initialCompleted);
  const [connectionWarn, setConnectionWarn] = useState(false);
  // Contador visible: duración conocida, reproducción y segundos vistos
  // (del servidor, más lo reproducido desde el último latido)
  const [duration, setDuration] = useState(data.durationSeconds ?? 0);
  const [playing, setPlaying] = useState(false);
  const [watched, setWatched] = useState(() =>
    data.initialCompleted
      ? (data.durationSeconds ?? 0)
      : (data.initialPercent / 100) * (data.durationSeconds ?? 0)
  );

  const positionRef = useRef(data.lastPosition);
  const durationRef = useRef(data.durationSeconds ?? 0);
  const maxPosRef = useRef(data.maxPosition);
  const lastTickRef = useRef(data.lastPosition);
  const playingRef = useRef(false);
  const completedRef = useRef(data.initialCompleted);
  const needsDurationRef = useRef(data.durationSeconds === null);
  const seekToastRef = useRef(false);
  const courseToastRef = useRef(false);
  const onCompletedRef = useRef(onCompleted);
  onCompletedRef.current = onCompleted;

  // El servidor acredita contra SU duración (la guardada); la del reproductor
  // solo alimenta el contador cuando aún no hay una guardada
  const timerDurationRef = useRef(data.durationSeconds ?? 0);
  const noteDuration = useCallback(
    (d: number) => {
      if (!Number.isFinite(d) || d <= 0) return;
      durationRef.current = d;
      if (data.durationSeconds !== null) return;
      timerDurationRef.current = d;
      setDuration((prev) => (Math.abs(prev - d) > 1 ? d : prev));
    },
    [data.durationSeconds]
  );
  const notePlaying = useCallback((isPlaying: boolean) => {
    playingRef.current = isPlaying;
    setPlaying(isPlaying);
  }, []);

  const warnSeekBlocked = useCallback(() => {
    if (seekToastRef.current) return;
    seekToastRef.current = true;
    toast("No puedes adelantar más allá de lo que has visto");
  }, []);

  // ─── Latido común (YouTube y Vimeo) ────────────────────────────────────────

  const beat = useCallback(async () => {
    const body: { courseId: string; itemId: string; position: number; duration?: number } = {
      courseId,
      itemId,
      position: positionRef.current,
    };
    // La duración solo viaja en el primer latido si el server no la tiene
    if (needsDurationRef.current && durationRef.current > 0) {
      body.duration = durationRef.current;
    }
    const sentDuration = body.duration !== undefined;
    const res = await sendVideoHeartbeat(body);
    if (!res || res.preview) return;
    if (sentDuration) needsDurationRef.current = false;

    maxPosRef.current = Math.max(maxPosRef.current, res.maxPosition);
    setPercent(completedRef.current ? 100 : res.percent);
    if (timerDurationRef.current > 0) {
      const serverWatched = (res.percent / 100) * timerDurationRef.current;
      // Sin «regresar» el contador por 1–3 s de redondeo o latencia
      setWatched((w) => (serverWatched < w && w - serverWatched <= 3 ? w : serverWatched));
    }
    if (res.completed && !completedRef.current) {
      completedRef.current = true;
      setCompleted(true);
      setPercent(100);
      setWatched(timerDurationRef.current);
      onCompletedRef.current();
    }
    if (res.courseCompleted && !courseToastRef.current) {
      courseToastRef.current = true;
      toast.success("¡Aprobaste el curso!");
    }
  }, [courseId, itemId]);

  // Latido cada 10 s con la pestaña visible. Con la pestaña oculta, si el
  // video SIGUE reproduciéndose (audio de fondo) el latido continúa cada 30 s
  // para no perder crédito; si está pausado, el latido se pausa también.
  useEffect(() => {
    let hiddenTicks = 0;
    const interval = window.setInterval(() => {
      // Sin duración conocida el server aún no puede acreditar: espera al player
      if (!(durationRef.current > 0 || !needsDurationRef.current)) return;
      if (document.visibilityState === "hidden") {
        if (!playingRef.current) return;
        hiddenTicks += 1;
        if (hiddenTicks % 3 !== 0) return; // 3 ticks de 10 s = cada 30 s
      } else {
        hiddenTicks = 0;
      }
      void beat();
    }, HEARTBEAT_MS);
    return () => window.clearInterval(interval);
  }, [beat]);

  // ─── YouTube: IFrame API + poll de 1 s ─────────────────────────────────────

  const ytHostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (data.provider !== "youtube") return;
    let player: YTPlayer | null = null;
    let poll: number | null = null;
    let cancelled = false;

    void loadYouTubeApi().then(() => {
      if (cancelled || !ytHostRef.current || !window.YT) return;
      player = new window.YT.Player(ytHostRef.current, {
        videoId: data.videoId,
        width: "100%",
        height: "100%",
        playerVars: {
          rel: 0,
          playsinline: 1,
          start: Math.max(0, Math.floor(data.lastPosition)),
        },
        events: {
          onReady: () => {
            if (!data.allowSpeedUp) player?.setPlaybackRate(1);
          },
          onStateChange: (e) => {
            // 1 = reproduciendo (el latido sigue aunque la pestaña se oculte)
            if (e.data === 1) notePlaying(true);
            // 2 = pausa, 0 = fin → latido inmediato
            if (e.data === 2 || e.data === 0) {
              notePlaying(false);
              const t = player?.getCurrentTime();
              if (typeof t === "number" && Number.isFinite(t)) {
                positionRef.current = t;
              }
              void beat();
            }
          },
        },
      });

      poll = window.setInterval(() => {
        if (!player || typeof player.getCurrentTime !== "function") return;
        const t = player.getCurrentTime();
        noteDuration(player.getDuration());
        if (!Number.isFinite(t)) return;

        if (!data.allowSpeedUp && player.getPlaybackRate() !== 1) {
          player.setPlaybackRate(1);
        }

        const jump = t - lastTickRef.current;
        // Bloqueo de adelanto: un salto (no reproducción continua) más allá
        // de la frontera vista. Retroceder y repasar es libre.
        if (
          !completedRef.current &&
          jump > PLAYBACK_JUMP_S &&
          t > maxPosRef.current + SEEK_TOLERANCE_S
        ) {
          player.seekTo(maxPosRef.current, true);
          lastTickRef.current = maxPosRef.current;
          positionRef.current = maxPosRef.current;
          warnSeekBlocked();
          return;
        }
        lastTickRef.current = t;
        positionRef.current = t;
        if (t > maxPosRef.current && jump <= PLAYBACK_JUMP_S) {
          maxPosRef.current = t;
        }
      }, 1000);
    });

    return () => {
      cancelled = true;
      if (poll !== null) window.clearInterval(poll);
      try {
        player?.destroy();
      } catch {
        // el player pudo no llegar a crearse
      }
    };
  }, [data.provider, data.videoId, data.allowSpeedUp, data.lastPosition, beat, warnSeekBlocked, noteDuration, notePlaying]);

  // ─── Vimeo: API postMessage (timeupdate ~250 ms) ───────────────────────────

  const vimeoRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    if (data.provider !== "vimeo") return;
    let connected = false;

    const post = (method: string, value?: unknown) => {
      vimeoRef.current?.contentWindow?.postMessage(
        JSON.stringify(value !== undefined ? { method, value } : { method }),
        "https://player.vimeo.com"
      );
    };

    const subscribe = () => {
      post("addEventListener", "timeupdate");
      post("addEventListener", "pause");
      post("addEventListener", "finish");
      if (!data.allowSpeedUp) post("setPlaybackRate", 1);
    };

    // Si en 10 s no llega ningún evento del player, avisamos sin bloquear
    const warnTimer = window.setTimeout(() => {
      if (!connected) setConnectionWarn(true);
    }, 10_000);

    const onMessage = (e: MessageEvent) => {
      if (typeof e.origin !== "string" || !e.origin.includes("vimeo.com")) return;
      let msg: { event?: string; data?: { seconds?: number; duration?: number } };
      try {
        msg = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
      } catch {
        return;
      }
      if (!msg || typeof msg !== "object") return;
      if (!connected) {
        connected = true;
        setConnectionWarn(false);
      }

      if (msg.event === "ready") {
        subscribe();
        if (!completedRef.current && data.lastPosition > 1) {
          post("setCurrentTime", data.lastPosition);
        }
      } else if (msg.event === "timeupdate" && msg.data) {
        if (!playingRef.current) notePlaying(true);
        const t = msg.data.seconds ?? 0;
        if (typeof msg.data.duration === "number") noteDuration(msg.data.duration);
        const jump = t - lastTickRef.current;
        if (
          !completedRef.current &&
          jump > PLAYBACK_JUMP_S &&
          t > maxPosRef.current + SEEK_TOLERANCE_S
        ) {
          post("setCurrentTime", maxPosRef.current);
          lastTickRef.current = maxPosRef.current;
          positionRef.current = maxPosRef.current;
          warnSeekBlocked();
          return;
        }
        lastTickRef.current = t;
        positionRef.current = t;
        if (t > maxPosRef.current && jump <= PLAYBACK_JUMP_S) {
          maxPosRef.current = t;
        }
      } else if (msg.event === "pause" || msg.event === "finish") {
        notePlaying(false);
        void beat();
      }
    };

    // Algunos embeds no emiten "ready" hasta recibir un primer mensaje
    const iframe = vimeoRef.current;
    const onLoad = () => subscribe();
    iframe?.addEventListener("load", onLoad);

    window.addEventListener("message", onMessage);
    return () => {
      window.clearTimeout(warnTimer);
      window.removeEventListener("message", onMessage);
      iframe?.removeEventListener("load", onLoad);
    };
  }, [data.provider, data.videoId, data.allowSpeedUp, data.lastPosition, beat, warnSeekBlocked, noteDuration, notePlaying]);

  // Cada segundo de contenido NUEVO reproducido baja el contador; repasar lo
  // ya visto no cuenta (igual que en el servidor)
  useEffect(() => {
    if (!playing || completed) return;
    const id = window.setInterval(() => {
      if (!playingRef.current || completedRef.current) return;
      if (positionRef.current < maxPosRef.current - 1.5) return;
      setWatched((w) => Math.min(timerDurationRef.current || w + 1, w + 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [playing, completed]);

  const remaining = Math.max(0, duration - watched);
  const shownPercent = completed
    ? 100
    : duration > 0
      ? Math.min(99, Math.round((watched / duration) * 100))
      : percent;
  const timerState: StudyTimerState = completed ? "done" : playing ? "running" : "paused";

  // ─── UI ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col">
      {/* Barra superior: título + % ACREDITADO (del servidor, no la posición) */}
      <div className="space-y-2 border-b bg-card px-4 py-2">
        <div className="flex items-center gap-3">
          <KindChip kind="video" />
          <h2 className="min-w-0 flex-1 truncate font-heading text-sm font-semibold">
            {title}
          </h2>
          {completed || duration > 0 ? (
            <StudyTimer
              remaining={remaining}
              total={duration}
              state={timerState}
              caption={`Video de ${formatClock(duration)} · ${shownPercent}% visto`}
              pausedHint="Reproduce el video para avanzar"
              doneLabel="Video completado"
            />
          ) : (
            <p className="shrink-0 text-sm tabular-nums text-muted-foreground" aria-live="polite">
              {percent}% visto
            </p>
          )}
        </div>
        {!completed && (
          <Progress
            value={shownPercent}
            className="h-1"
            aria-label={`Video visto al ${shownPercent}%`}
          />
        )}
      </div>

      {connectionWarn && (
        <p className="flex items-center gap-2 border-b bg-warning/10 px-4 py-2 text-sm text-warning">
          <TriangleAlert className="size-4 shrink-0" aria-hidden />
          No pudimos conectar con el reproductor — el progreso podría no
          registrarse.
        </p>
      )}

      <div className="flex flex-1 items-center justify-center overflow-auto bg-muted/60 p-4">
        <div className="w-full max-w-4xl">
          <div className="aspect-video w-full overflow-hidden rounded-xl bg-black shadow-sm">
            {data.provider === "youtube" ? (
              <div ref={ytHostRef} className="size-full" />
            ) : (
              <iframe
                ref={vimeoRef}
                src={`https://player.vimeo.com/video/${data.videoId}`}
                className="size-full border-0"
                allow="autoplay; fullscreen; picture-in-picture"
                allowFullScreen
                title={title}
              />
            )}
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Wifi className="size-3.5 shrink-0" aria-hidden />
            Este video requiere internet.
          </p>
        </div>
      </div>
    </div>
  );
}
