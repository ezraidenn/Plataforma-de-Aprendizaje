/**
 * Revisión de la ayuda visual: abre /teach/ayuda con sesión de maestro,
 * comprueba que cada escena tenga tamaño y contenido, y la fotografía en dos
 * instantes del ciclo (para ver que se mueve) y en su cuadro final con
 * «reducir movimiento» (<tema>-final.png). Uso (servidor en :3000):
 *   pnpm help:shots
 * Deja las imágenes en <tmp>/lms-ayuda y falla si alguna escena está vacía.
 */
const Database = require("better-sqlite3");
const { createHash, randomBytes } = require("node:crypto");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const OUT = path.join(os.tmpdir(), "lms-ayuda");
const PORT = 9455;
const CHROME = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find((p) => p && fs.existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Sesión temporal del maestro demo (se borra al terminar)
const db = new Database(path.join(process.cwd(), "data", "data.db"));
const teacher = db.prepare("SELECT id FROM users WHERE email = 'maestro@empresa.local'").get();
const token = randomBytes(24).toString("base64url");
const hash = createHash("sha256").update(token).digest("hex");
db.prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(hash, teacher.id, Date.now() + 600_000, Date.now());
const cleanup = () => {
  try {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(hash);
  } catch {}
};

(async () => {
  if (!CHROME) throw new Error("No encontré Chrome/Edge (define CHROME_PATH)");
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "lms-ayuda-chrome-"));
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
  const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.result.value;

  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send("Network.setCookie", { name: "session", value: token, url: BASE, path: "/" });
  await send("Page.navigate", { url: `${BASE}/teach/ayuda` });
  await sleep(3000);

  const scenes =
    (await evaluate(`[...document.querySelectorAll("[data-scene]")].map((el) => {
      const r = el.getBoundingClientRect();
      return { topic: el.dataset.scene, w: r.width, h: r.height, text: el.innerText.trim().length };
    })`)) ?? [];
  let bad = 0;
  if (scenes.length === 0) {
    console.log("✗ No hay escenas en /teach/ayuda");
    bad++;
  }
  for (const s of scenes) {
    const ok = s.w > 100 && s.h > 100 && s.text > 0;
    if (!ok) bad++;
    console.log(`${ok ? "✓" : "✗"} ${s.topic} (${Math.round(s.w)}×${Math.round(s.h)}, ${s.text} caracteres)`);
  }

  // Dos instantes del ciclo por escena, separados 2.6 s (los ciclos duran 7–10.5 s:
  // nunca coinciden). Antes se tomaban todas las «a» y luego todas las «b», y en
  // las escenas de 9 s ambas caían en el mismo instante.
  const capture = async (topic, label) => {
    const clip = await evaluate(`(() => {
      const r = document.querySelector('[data-scene="${topic}"]').getBoundingClientRect();
      return { x: r.x + window.scrollX, y: r.y + window.scrollY, width: r.width, height: r.height, scale: 1 };
    })()`);
    const shot = await send("Page.captureScreenshot", { format: "png", clip, captureBeyondViewport: true });
    fs.writeFileSync(path.join(OUT, `${topic}-${label}.png`), Buffer.from(shot.result.data, "base64"));
  };
  for (const s of scenes) {
    await capture(s.topic, "a");
    await sleep(2600);
    await capture(s.topic, "b");
  }

  // Cuadro final con «reducir movimiento» (la escena queda quieta en su resultado)
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await send("Page.reload");
  await sleep(3000);
  for (const s of scenes) await capture(s.topic, "final");

  console.log(`\nCapturas en ${OUT}`);
  proc.kill();
  cleanup();
  setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 500);
  console.log(bad ? `\n❌ ${bad} escena(s) vacías` : "\n✅ ESCENAS OK");
  process.exit(bad ? 1 : 0);
})().catch((err) => {
  console.error(err);
  cleanup();
  process.exit(1);
});
