/**
 * Prueba del «?» en pantallas reales (curso demo de Extintores, Grupos,
 * Vencimientos, plantilla y, como administrador, Ajustes y Configuración).
 * En cada página: cada «?» abre con el ratón, carga su escena, cabe en la
 * ventana y se cierra al salir; el primero se fija con clic, se cierra con Esc
 * y se abre con Enter (el foco vuelve al «?»). Algunas páginas hacen pasos
 * previos (abrir la Papelera, el diálogo de matrícula o elegir un campo) y
 * buscan los «?» solo dentro del diálogo. Al final, a 390 px la tarjeta debe
 * caber a lo ancho. Deja capturas en <tmp>/lms-ayuda-tips.
 * Uso (servidor en :3000): pnpm help:tips
 */
const Database = require("better-sqlite3");
const { createHash, randomBytes } = require("node:crypto");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const OUT = path.join(os.tmpdir(), "lms-ayuda-tips");
const PORT = 9456;
const CHROME = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find((p) => p && fs.existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TIP = 'button[aria-label^="Cómo funciona"]';

const db = new Database(path.join(process.cwd(), "data", "data.db"));
const course = db.prepare("SELECT id FROM courses WHERE title LIKE 'Uso y Manejo de Extintores%' LIMIT 1").get();
const template = db.prepare("SELECT id FROM certificate_templates LIMIT 1").get();
const itemOf = (kind) => db.prepare("SELECT id FROM course_items WHERE course_id = ? AND kind = ? LIMIT 1").get(course.id, kind)?.id;
const C = `/teach/courses/${course.id}`;
const clickText = (selector, text) =>
  `[...document.querySelectorAll('${selector}')].find((el) => el.textContent.trim().startsWith(${JSON.stringify(text)}))?.click()`;
/** Como un clic real: las pestañas de Radix se activan con «mousedown», no con click(). */
const pressText = (selector, text) =>
  `(() => { const el = [...document.querySelectorAll('${selector}')].find((e) => e.textContent.trim().startsWith(${JSON.stringify(text)}));
    for (const type of ["mousedown", "mouseup", "click"]) el?.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 })); })()`;

/** name, url, min «?»; opcional: as (sesión), before (JS en orden), scope (dónde buscar los «?») */
const PAGES = [
  { name: "ajustes", url: `${C}/settings`, min: 5 },
  { name: "reglas", url: `${C}/rules`, min: 2 },
  { name: "documento", url: `${C}/content?item=${itemOf("document")}`, min: 4 },
  { name: "lectura", url: `${C}/content?item=${itemOf("text")}`, min: 4 },
  { name: "video", url: `${C}/content?item=${itemOf("video")}`, min: 4 },
  { name: "recurso", url: `${C}/content?item=${itemOf("resource")}`, min: 4 },
  { name: "enlace", url: `${C}/content?item=${itemOf("link")}`, min: 4 },
  { name: "tarea", url: `${C}/content?item=${itemOf("assignment")}`, min: 7 },
  { name: "examen", url: `${C}/items/${itemOf("exam")}/edit`, min: 10 },
  { name: "grupos", url: "/teach/groups", min: 1 },
  { name: "vencimientos", url: "/teach/renewals?tab=expired", min: 1 },
  { name: "papelera", url: `${C}/students`, min: 1, before: [`document.querySelector('button[aria-label^="Papelera"]')?.click()`], scope: '[role="dialog"]' },
  {
    name: "traer-grupo",
    url: `${C}/students`,
    min: 1,
    before: [clickText("button", "Matricular estudiantes"), pressText('[role="tab"]', "Traer grupo")],
    scope: '[role="dialog"]',
  },
  { name: "plantilla", url: `/teach/templates/${template.id}`, min: 1, before: [clickText("li button", "Código QR")] },
  { name: "identidad", url: "/ajustes", min: 1, as: "admin" },
  { name: "almacenamiento", url: "/admin/settings", min: 1, as: "admin" },
];

/** Sesión temporal de un usuario demo (se borra al terminar). */
function session(email) {
  const user = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  const token = randomBytes(24).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  db.prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(hash, user.id, Date.now() + 900_000, Date.now());
  return { token, hash };
}
const teacherSession = session("maestro@empresa.local");
const adminSession = session("admin@empresa.local");
const cleanup = () => {
  try {
    db.prepare("DELETE FROM sessions WHERE id IN (?, ?)").run(teacherSession.hash, adminSession.hash);
  } catch {}
};

let failures = 0;
const check = (name, cond, detail) => {
  if (!cond) failures++;
  console.log(`  ${cond ? "✓" : "✗"} ${name}${!cond && detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
};

(async () => {
  if (!CHROME) throw new Error("No encontré Chrome/Edge (define CHROME_PATH)");
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "lms-tips-chrome-"));
  const proc = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
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
  const ev = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.result?.value;
  const move = (x, y) => send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  const click = async (x, y) => {
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  };
  const key = async (k, code, vk, text) => {
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, ...(text ? { text } : {}) });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk });
  };
  const popState = () =>
    ev(`(() => { const p = document.querySelector('[data-slot="popover-content"]'); if (!p) return null; const r = p.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, scene: !!p.querySelector('[data-scene] > :not(.animate-pulse)'), text: p.innerText.slice(-300) }; })()`);
  const tipRect = (i, sel = TIP) =>
    ev(`(() => { const b = document.querySelectorAll('${sel}')[${i}]; b.scrollIntoView({ block: "center", behavior: "instant" });
      const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, label: b.getAttribute("aria-label") }; })()`);
  const shot = async (name, pop, tip) => {
    const [sx, sy] = await ev(`[window.scrollX, window.scrollY]`);
    const x = Math.max(0, Math.min(tip.x, pop.x) - 30);
    const y = Math.max(0, Math.min(tip.y, pop.y) - 30);
    const w = Math.max(tip.x, pop.x + pop.w) - x + 30;
    const h = Math.max(tip.y, pop.y + pop.h) - y + 30;
    const s = await send("Page.captureScreenshot", { format: "png", clip: { x: x + sx, y: y + sy, width: w, height: h, scale: 1 }, captureBeyondViewport: true });
    fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(s.result.data, "base64"));
  };
  const open = async (url, width, height, mobile) => {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
    await send("Page.navigate", { url: BASE + url });
    await sleep(2500);
    await ev(`document.documentElement.style.setProperty("scroll-behavior", "auto", "important")`);
  };

  await send("Page.enable");

  for (const page of PAGES) {
    const { name, url, min } = page;
    const tips = page.scope ? `${page.scope} ${TIP}` : TIP;
    console.log(`\n— ${name} (${url})`);
    await send("Network.setCookie", { name: "session", value: page.as === "admin" ? adminSession.token : teacherSession.token, url: BASE, path: "/" });
    await open(url, 1366, 900, false);
    for (const step of page.before ?? []) {
      await ev(step);
      await sleep(900);
    }
    const n = await ev(`document.querySelectorAll('${tips}').length`);
    check(`hay al menos ${min} «?» (${n})`, n >= min, n);
    if (!n) continue;

    if (name === "reglas") {
      const SEL = `[aria-label="Cómo se combinan las condiciones"] [role=radio]`;
      await ev(`document.querySelectorAll('${SEL}')[1]?.click()`);
      await sleep(200);
    }

    for (let i = 0; i < n; i++) {
      const tip = await tipRect(i, tips);
      await move(5, 5);
      await sleep(300);
      await move(tip.x, tip.y);
      await sleep(1600);
      const pop = await popState();
      const label = tip.label.replace("Cómo funciona: ", "");
      check(`«${label}»: abre con hover, carga la escena y cabe`, !!pop && pop.scene && pop.x >= 0 && pop.y >= 0 && pop.x + pop.w <= 1366 && pop.y + pop.h <= 900, pop);
      if (name === "reglas" && label.startsWith("Combinar") && pop) check("la frase refleja el O elegido (sin guardar)", pop.text.includes("O (al menos una)"), pop.text);
      if (pop) await shot(`${name}-${i + 1}`, pop, tip);
      await move(5, 5);
      await sleep(500);
      check(`«${label}»: se cierra al salir`, (await popState()) === null);
    }

    // Clic y teclado sobre el primero (en diálogos, Esc cerraría también el diálogo: se omite ahí)
    const first = await tipRect(0, tips);
    await click(first.x, first.y);
    await sleep(400);
    await move(5, 5);
    await sleep(500);
    check("clic la deja fija", (await popState()) !== null);
    if (!page.scope) {
      await key("Escape", "Escape", 27);
      await sleep(300);
      check("Esc la cierra", (await popState()) === null);
      await ev(`document.querySelectorAll('${tips}')[0].focus()`);
      await key("Enter", "Enter", 13, "\r");
      await sleep(600);
      check("Enter abre", (await popState()) !== null);
      await key("Escape", "Escape", 27);
      await sleep(300);
      const focusOk = await ev(`document.activeElement?.getAttribute("aria-label")?.startsWith("Cómo funciona") ?? false`);
      check("Esc cierra y el foco sigue en el «?»", (await popState()) === null && focusOk);
    }
  }

  console.log("\n— celular 390 px (ajustes)");
  await send("Network.setCookie", { name: "session", value: teacherSession.token, url: BASE, path: "/" });
  await open(PAGES[0].url, 390, 844, true);
  const tip = await tipRect(1);
  await click(tip.x, tip.y);
  await sleep(1500);
  const pop = await popState();
  check("abre y cabe en 390 px", !!pop && pop.scene && pop.x >= 0 && pop.x + pop.w <= 390, pop);
  if (pop) await shot("celular", pop, tip);

  proc.kill();
  cleanup();
  setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 500);
  console.log(`\nCapturas en ${OUT}`);
  console.log(failures ? `\n❌ ${failures} falla(s)` : "\n✅ «?» OK");
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error(err);
  cleanup();
  process.exit(1);
});
