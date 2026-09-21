/**
 * Revisión de las escenas de la guía: abre /guia con sesión de administrador,
 * recorre las pestañas de Estudiante y Maestro, comprueba que cada escena
 * tenga tamaño y contenido y la fotografía en dos instantes del ciclo y en su
 * cuadro final con «reducir movimiento». Uso (servidor en :3000):
 *   pnpm guide:scenes
 * Deja las imágenes en <tmp>/lms-guia y falla si alguna escena está vacía.
 */
const Database = require("better-sqlite3");
const { createHash, randomBytes } = require("node:crypto");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const OUT = path.join(os.tmpdir(), "lms-guia");
const PORT = 9463;
const CHROME = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find((p) => p && fs.existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const db = new Database(path.join(process.cwd(), "data", "data.db"));
// El administrador es el único que ve las tres pestañas de la guía
const teacher = db.prepare("SELECT id FROM users WHERE email = 'admin@empresa.local'").get();
const token = randomBytes(24).toString("base64url");
const hash = createHash("sha256").update(token).digest("hex");
db.prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(hash, teacher.id, Date.now() + 900_000, Date.now());
const cleanup = () => {
  try {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(hash);
  } catch {}
};

(async () => {
  if (!CHROME) throw new Error("No encontré Chrome/Edge (define CHROME_PATH)");
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "lms-guia-chrome-"));
  const proc = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--hide-scrollbars", "--window-size=1400,1000", "about:blank"], { stdio: "ignore" });

  let ws;
  for (let i = 0; i < 60 && !ws; i++) {
    try {
      const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
      if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
    } catch {}
    if (!ws) await sleep(250);
  }
  await new Promise((r) => ws.addEventListener("open", r));
  let seq = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  });
  const send = (method, params = {}) =>
    new Promise((r) => {
      const id = ++seq;
      pending.set(id, r);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.result?.value;

  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send("Network.setCookie", { name: "session", value: token, url: BASE, path: "/" });

  /** Las pestañas de Radix se activan con mousedown, no con click(). */
  const openRole = (label) =>
    evaluate(`(() => {
      const tab = [...document.querySelectorAll('[role="tab"]')].find((t) => t.innerText.trim().includes(${JSON.stringify(label)}));
      if (!tab) return false;
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) tab.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0 }));
      tab.click();
      return true;
    })()`);

  /**
   * Carga las imágenes perezosas de la página. Si no, se cargan mientras se
   * fotografía, empujan el contenido y la escena sale de la vista (se desmonta
   * y la foto sale vacía).
   */
  const settleImages = async () => {
    await evaluate(`(async () => {
      const imgs = [...document.querySelectorAll("img")];
      for (const img of imgs) img.loading = "eager";
      await Promise.all(imgs.map((i) => (i.complete ? null : i.decode().catch(() => null))));
      return imgs.length;
    })()`);
    await sleep(600);
  };

  /** Acerca la escena, espera a que se monte y devuelve su tamaño y su texto. */
  const measure = async (topic) => {
    const found = await evaluate(`(() => {
      const el = document.querySelector('[data-scene="${topic}"]');
      if (!el) return false;
      el.scrollIntoView({ behavior: "instant", block: "center" });
      return true;
    })()`);
    if (!found) return null;
    // Espera a que la escena se descargue y pinte (hasta 12 s: con la página
    // larga del maestro, a veces tarda en montarse)
    let last = null;
    for (let i = 0; i < 40; i++) {
      // Se vuelve a acercar en cada intento: al cargarse una imagen, el
      // contenido se mueve y la escena puede salir de la vista otra vez.
      last = await evaluate(`(() => {
        const el = document.querySelector('[data-scene="${topic}"]');
        if (!el) return null;
        el.scrollIntoView({ behavior: "instant", block: "center" });
        const r = el.getBoundingClientRect();
        return { w: r.width, h: r.height, text: el.innerText.trim().length };
      })()`);
      if (last && last.text > 0) break;
      // Cada 10 intentos, un empujón: en la página larga del maestro el
      // observador a veces no vuelve a disparar y la escena no se monta.
      if (i > 0 && i % 10 === 0) {
        await evaluate(`window.scrollBy({ top: 400, behavior: "instant" })`);
        await sleep(400);
      }
      await sleep(300);
    }
    return last;
  };

  const capture = async (topic, label) => {
    // Esperar a que la escena esté pintada: si el scroll la sacó de la vista se
    // desmonta, y al volver tarda en descargarse (si no, la foto sale vacía).
    const ready = await measure(topic);
    if (!ready || ready.text === 0) return false;
    const clip = await evaluate(`(() => {
      const el = document.querySelector('[data-scene="${topic}"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + window.scrollX, y: r.y + window.scrollY, width: r.width, height: r.height, scale: 1 };
    })()`);
    if (!clip) return false;
    const shot = await send("Page.captureScreenshot", { format: "png", clip, captureBeyondViewport: true });
    fs.writeFileSync(path.join(OUT, `${topic}-${label}.png`), Buffer.from(shot.result.data, "base64"));
    return true;
  };

  let bad = 0;
  const seen = [];
  const byRole = [];
  for (const role of ["Estudiante", "Maestro", "Administrador"]) {
    await send("Page.navigate", { url: `${BASE}/guia` });
    await sleep(2500);
    const opened = await openRole(role);
    if (!opened) {
      bad++;
      console.log(`✗ No encontré la pestaña «${role}»`);
      continue;
    }
    await sleep(1200);
    await settleImages();

    // Una por una: la escena solo se monta cuando está a la vista
    const topics = (await evaluate(`[...document.querySelectorAll("[data-scene]")].map((el) => el.dataset.scene)`)) ?? [];
    byRole.push({ role, topics });
    for (const topic of topics) {
      const m = await measure(topic);
      const ok = m && m.w > 100 && m.h > 100 && m.text > 0;
      if (!ok) bad++;
      seen.push(topic);
      console.log(`${ok ? "✓" : "✗"} ${role} · ${topic} (${m ? `${Math.round(m.w)}×${Math.round(m.h)}, ${m.text} caracteres` : "no aparece"})`);
      await capture(topic, "a");
      await sleep(2600);
      await capture(topic, "b");
    }
  }

  // Cuadro final con «reducir movimiento». Hay que volver a abrir cada pestaña:
  // al recargar, la guía abre la del rol del usuario, no la que se estaba viendo.
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  for (const { role, topics } of byRole) {
    if (topics.length === 0) continue;
    await send("Page.navigate", { url: `${BASE}/guia` });
    await sleep(2500);
    await openRole(role);
    await sleep(1200);
    await settleImages();
    for (const topic of topics) {
      const m = await measure(topic);
      const ok = await capture(topic, "final");
      if (!ok || !m) {
        bad++;
        console.log(`✗ cuadro final de ${topic}`);
      }
    }
  }

  console.log(`\nCapturas en ${OUT}`);
  proc.kill();
  cleanup();
  setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 500);
  console.log(bad ? `\n❌ ${bad} escena(s) vacías` : `\n✅ ESCENAS DE LA GUÍA OK (${seen.length})`);
  process.exit(bad ? 1 : 0);
})().catch((err) => {
  console.error(err);
  cleanup();
  process.exit(1);
});
