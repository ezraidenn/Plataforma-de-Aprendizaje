import "server-only";
import os from "node:os";
import { createSocket } from "node:dgram";

/**
 * Dirección con la que se llega al servidor desde la red local. Es la que se
 * imprime en el código QR de los certificados, así que tiene que ser la IP real
 * del equipo, no `localhost`.
 *
 * Orden: variable `APP_URL` (si el administrador la fijó) → IPv4 de la interfaz
 * por la que sale el tráfico → `localhost`.
 */

const PORT = process.env.PORT ?? "3000";

let cached: string | null = null;
let cachedAt = 0;
/** La IP puede cambiar (DHCP, cambio de Wi-Fi): se revisa cada 5 minutos. */
const TTL_MS = 5 * 60_000;

/**
 * IPv4 de la interfaz que el sistema usaría para salir a la red. Abre un socket
 * UDP «conectado» (no envía ni un byte, solo resuelve la ruta), que es la forma
 * fiable de distinguir la tarjeta real de las virtuales (VirtualBox, WSL,
 * Hyper-V) cuando hay varias.
 */
function detectRouteIp(): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const socket = createSocket("udp4");
    const finish = (ip: string | null) => {
      if (settled) return;
      settled = true;
      try {
        socket.close();
      } catch {
        /* ya cerrado */
      }
      resolve(ip);
    };
    socket.on("error", () => finish(null));
    const timer = setTimeout(() => finish(null), 400);
    timer.unref?.();
    try {
      // 192.0.2.1 es una dirección reservada para documentación: no genera tráfico
      socket.connect(9, "192.0.2.1", () => {
        try {
          const addr = socket.address().address;
          finish(addr && addr !== "0.0.0.0" ? addr : null);
        } catch {
          finish(null);
        }
      });
    } catch {
      finish(null);
    }
  });
}

/** Interfaces habituales de virtualización: se dejan para el final. */
const VIRTUAL = /virtualbox|vmware|hyper-v|loopback|wsl|docker|tailscale|zerotier|vethernet/i;

/** Reserva: la primera IPv4 no interna, prefiriendo tarjetas no virtuales. */
function detectFromInterfaces(): string | null {
  const candidates: { ip: string; virtual: boolean }[] = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family !== "IPv4" || addr.internal) continue;
      // 169.254.x.x es «sin DHCP»: no sirve para que otros equipos entren
      if (addr.address.startsWith("169.254.")) continue;
      candidates.push({ ip: addr.address, virtual: VIRTUAL.test(name) });
    }
  }
  candidates.sort((a, b) => Number(a.virtual) - Number(b.virtual));
  return candidates[0]?.ip ?? null;
}

/** IPv4 con la que otros equipos de la red alcanzan al servidor. */
export async function detectLanIp(): Promise<string | null> {
  return (await detectRouteIp()) ?? detectFromInterfaces();
}

/**
 * URL base del servidor. Se cachea unos minutos para no sondear en cada
 * certificado emitido.
 */
export async function appUrl(): Promise<string> {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");

  const now = Date.now();
  if (cached && now - cachedAt < TTL_MS) return cached;

  const ip = await detectLanIp();
  cached = `http://${ip ?? "localhost"}:${PORT}`;
  cachedAt = now;
  return cached;
}

/** Para mostrarlo en Admin → Configuración. */
export async function appUrlInfo(): Promise<{
  url: string;
  source: "variable de entorno" | "detectada automáticamente" | "sin red";
  ip: string | null;
}> {
  const configured = process.env.APP_URL?.trim();
  if (configured) {
    return { url: configured.replace(/\/$/, ""), source: "variable de entorno", ip: null };
  }
  const ip = await detectLanIp();
  return {
    url: `http://${ip ?? "localhost"}:${PORT}`,
    source: ip ? "detectada automáticamente" : "sin red",
    ip,
  };
}
