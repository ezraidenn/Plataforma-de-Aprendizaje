/**
 * Capturas REALES para la guía de uso: controla Chrome (headless) con el
 * protocolo DevTools usando solo Node (sin dependencias), entra con cada rol,
 * navega, abre menús/diálogos, remarca el elemento del paso y guarda JPEG en
 * public/guide/<id>.jpg. Uso (con el servidor corriendo en :3000):
 *   node scripts/guide-shots.cjs            → todas
 *   node scripts/guide-shots.cjs teacher-   → solo ids que empiecen así
 */
const Database = require("better-sqlite3");
const { createHash, randomBytes } = require("node:crypto");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PORT = 9333;
const OUT = path.join(process.cwd(), "public", "guide");
const ONLY = process.argv[2] ?? "";
const SCALE = 1.25;

const CHROME_CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  path.join(process.env.LOCALAPPDATA ?? "", "Google/Chrome/Application/chrome.exe"),
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
];

// ─── Sesiones y datos de la BD ──────────────────────────────────────────────

const db = new Database(path.join(process.cwd(), "data", "data.db"));
function makeSession(email) {
  const user = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (!user) throw new Error("No existe el usuario " + email);
  const token = randomBytes(24).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  db.prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(hash, user.id, Date.now() + 3600_000, Date.now());
  return { token, hash };
}
const courseRow = db.prepare("SELECT id FROM courses WHERE status='published' AND title LIKE 'Uso y Manejo%'").get();
const examItem = db.prepare("SELECT id FROM course_items WHERE course_id = ? AND kind='exam' ORDER BY position LIMIT 1").get(courseRow.id);
const assignItem = db.prepare("SELECT id FROM course_items WHERE course_id = ? AND kind='assignment' ORDER BY position LIMIT 1").get(courseRow.id);
// Alumno que YA puede presentar el examen parcial pero no lo ha hecho (progreso del ítem no bloqueado)
const prevOf = (itemId) => db.prepare(`SELECT p.id FROM course_items i JOIN course_items p ON p.parent_id IS i.parent_id AND p.course_id = i.course_id AND p.position < i.position
  WHERE i.id = ? ORDER BY p.position DESC LIMIT 1`).get(itemId)?.id ?? null;
const readyFor = (itemId, notExistsSql) => {
  const prev = prevOf(itemId);
  if (!prev) return null;
  return db.prepare(`SELECT u.email FROM enrollments e JOIN users u ON u.id = e.student_id
    JOIN item_progress ip ON ip.enrollment_id = e.id AND ip.item_id = ? AND ip.status = 'completed'
    WHERE e.course_id = ? AND e.status = 'active' AND NOT EXISTS (${notExistsSql}) LIMIT 1`).get(prev, courseRow.id, itemId);
};
const examReady = readyFor(examItem.id, "SELECT 1 FROM exam_attempts a WHERE a.student_id = u.id AND a.exam_item_id = ?");
// Alumno con la tarea desbloqueada y sin entrega
const assignReady = readyFor(assignItem.id, "SELECT 1 FROM assignment_submissions s WHERE s.student_id = u.id AND s.item_id = ?");
const videoItem = db.prepare("SELECT id FROM course_items WHERE course_id = ? AND kind='video' ORDER BY position LIMIT 1").get(courseRow.id);
const videoReady = videoItem ? readyFor(videoItem.id, "SELECT 1 FROM item_progress vp WHERE vp.enrollment_id = e.id AND vp.item_id = ? AND vp.status = 'completed'") : null;
console.log("examReady:", examReady?.email ?? "(ninguno)", "· assignReady:", assignReady?.email ?? "(ninguno)", "· videoReady:", videoReady?.email ?? "(ninguno)");

const sessions = {
  examReady: examReady ? makeSession(examReady.email) : null,
  assignReady: assignReady ? makeSession(assignReady.email) : null,
  videoReady: videoReady ? makeSession(videoReady.email) : null,
  teacher: makeSession("maestro@empresa.local"),
  student: makeSession("estudiante@empresa.local"),
  graduate: makeSession("maria.lopez@empresa.local"),
  admin: makeSession("admin@empresa.local"),
};
process.on("exit", () => {
  try {
    for (const s of Object.values(sessions)) if (s) db.prepare("DELETE FROM sessions WHERE id = ?").run(s.hash);
  } catch {}
});

const course = db.prepare("SELECT id FROM courses WHERE status='published' AND title LIKE 'Uso y Manejo%'").get();
const pick = (kind) => db.prepare("SELECT id, title FROM course_items WHERE course_id = ? AND kind = ? ORDER BY position LIMIT 1").get(course.id, kind) ?? null;
const data = {
  courseId: course.id,
  items: { text: pick("text"), document: pick("document"), video: pick("video"), exam: pick("exam"), assignment: pick("assignment"), resource: pick("resource"), link: pick("link") },
  templateId: db.prepare("SELECT id FROM certificate_templates ORDER BY created_at DESC LIMIT 1").get()?.id,
  studentId: db.prepare("SELECT id FROM users WHERE email='estudiante@empresa.local'").get().id,
  graduateId: db.prepare("SELECT id FROM users WHERE email='maria.lopez@empresa.local'").get().id,
  folio: db.prepare("SELECT folio FROM certificates WHERE revoked = 0 ORDER BY created_at DESC LIMIT 1").get()?.folio ?? "",
  // F8 (datos de scripts/seed-demo-cycles.ts): curso con vigencia de 12 meses y un folio vencido
  auxCourseId: db.prepare("SELECT id FROM courses WHERE title = 'Primeros Auxilios Básicos'").get()?.id ?? course.id,
  expiredFolio:
    db.prepare("SELECT folio FROM certificates WHERE revoked = 0 AND expires_at < ? ORDER BY expires_at DESC LIMIT 1").get(Date.now())?.folio ?? "",
};

// ─── Chrome + CDP mínimo ────────────────────────────────────────────────────

function findChrome() {
  for (const c of CHROME_CANDIDATES) if (c && fs.existsSync(c)) return c;
  throw new Error("No encontré Chrome/Edge. Define CHROME_PATH.");
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners.get(msg.method) ?? []) fn(msg.params);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }
  once(method) {
    return new Promise((resolve) => this.on(method, resolve));
  }
}

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res);
    ws.addEventListener("error", rej);
  });
  return new CDP(ws);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launchChrome() {
  const exe = process.env.CHROME_PATH ?? findChrome();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "lms-shots-"));
  const proc = spawn(exe, [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars",
    "--disable-gpu",
    "--window-size=1440,900",
    "--force-device-scale-factor=1",
    "--lang=es-MX",
    "about:blank",
  ], { stdio: "ignore" });
  for (let i = 0; i < 60; i++) {
    try {
      const v = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
      return { proc, wsUrl: v.webSocketDebuggerUrl, profile };
    } catch {
      await sleep(250);
    }
  }
  throw new Error("Chrome no respondió en el puerto de depuración");
}

// ─── Utilidades de página ───────────────────────────────────────────────────

/** Código inyectado: buscar elementos por texto/selector y dibujar remarcados. */
const HELPERS = `
// Sin scroll suave: medir a medio desplazamiento descuadra clics y remarcados
document.documentElement.style.setProperty("scroll-behavior", "auto", "important");
window.__find = function(t){
  if (t.sel) { const els=[...document.querySelectorAll(t.sel)]; return els[t.nth||0] || null; }
  const tags = t.tag ? t.tag.split(",") : ["button","a","[role=menuitem]","[role=tab]","[role=option]","label","summary","h1","h2","h3","h4","th","td","li","p","span","div"];
  const norm = s => (s||"").replace(/\\s+/g," ").trim().toLowerCase();
  const want = norm(t.text);
  let best=null;
  for (const tag of tags) for (const el of document.querySelectorAll(tag)) {
    const tx = norm(el.textContent);
    if (!tx) continue;
    const ok = t.exact ? tx===want : tx.includes(want);
    if (!ok) continue;
    const r = el.getBoundingClientRect(); if (r.width<2||r.height<2) continue;
    if (!best || (r.width*r.height) < best.area) best={el, area:r.width*r.height};
  }
  return best ? best.el : null;
};
window.__rect = function(t){ const el=window.__find(t); if(!el) return null; el.scrollIntoView({block:"center",inline:"nearest"}); const r=el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height}; };
window.__hl = function(targets){
  document.querySelectorAll(".__hl").forEach(n=>n.remove());
  const out=[]; const placed=[];
  const overlaps=(a,b)=>!(a.right<b.left||a.left>b.right||a.bottom<b.top||a.top>b.bottom);
  const first = targets.length ? window.__find(targets[0]) : null;
  if (first) { const fr = first.getBoundingClientRect(); if (fr.top < 0 || fr.bottom > innerHeight) first.scrollIntoView({block: fr.height > innerHeight*0.8 ? "start" : "center"}); }
  for (const t of targets) {
    const el = window.__find(t); if (!el) { out.push("MISSING:"+(t.text||t.sel)); continue; }
    const rr = el.getBoundingClientRect();
    if (rr.bottom < 0 || rr.top > innerHeight) { out.push("OK"); continue; } // fuera de pantalla: no dibujar
    const top = Math.max(8, rr.top), bottom = Math.min(innerHeight-8, rr.bottom), left = Math.max(8, rr.left), right = Math.min(innerWidth-8, rr.right);
    const r = { left, top, width: right-left, height: bottom-top, bottom, right };
    const pad = t.pad ?? 6;
    const box = document.createElement("div"); box.className="__hl";
    box.style.cssText = "position:fixed;z-index:2147483000;pointer-events:none;border:3px solid #ef4444;border-radius:10px;box-shadow:0 0 0 6px rgba(239,68,68,.18),0 0 0 9999px rgba(15,23,42,"+(t.dim===false?0:.10)+");left:"+(r.left-pad)+"px;top:"+(r.top-pad)+"px;width:"+(r.width+pad*2)+"px;height:"+(r.height+pad*2)+"px";
    const lab = document.createElement("div"); lab.className="__hl"; lab.textContent=t.label;
    lab.style.cssText = "position:fixed;z-index:2147483001;pointer-events:none;background:#ef4444;color:#fff;font:700 13px/1 Inter,'Segoe UI',system-ui,sans-serif;padding:6px 10px;border-radius:999px;box-shadow:0 6px 14px -6px rgba(0,0,0,.5);white-space:nowrap;left:0;top:0";
    document.body.append(box, lab);
    const lw = lab.offsetWidth, lh = lab.offsetHeight;
    // Candidatos: arriba-izq, abajo-izq, arriba-der, abajo-der, dentro-arriba
    const cands = [
      {left:r.left-pad, top:r.top-pad-lh-6},
      {left:r.left-pad, top:r.bottom+pad+6},
      {left:r.right+pad-lw, top:r.top-pad-lh-6},
      {left:r.right+pad-lw, top:r.bottom+pad+6},
      {left:r.left-pad+8, top:r.top-pad+8},
    ];
    let pos = cands[cands.length-1];
    for (const c of cands) {
      const rect = {left:c.left, top:c.top, right:c.left+lw, bottom:c.top+lh};
      if (rect.top < 4 || rect.left < 4 || rect.right > innerWidth-4 || rect.bottom > innerHeight-4) continue;
      if (placed.some(p=>overlaps(p, rect))) continue;
      pos = c; break;
    }
    lab.style.left = Math.max(4, pos.left)+"px"; lab.style.top = Math.max(4, pos.top)+"px";
    placed.push({left:pos.left, top:pos.top, right:pos.left+lw, bottom:pos.top+lh});
    out.push("OK");
  }
  return out;
};
`;

async function newPage(browser, viewport) {
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const entry = list.find((t) => t.id === targetId);
  const page = await connect(entry.webSocketDebuggerUrl);
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("Network.enable");
  await page.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: SCALE,
    mobile: !!viewport.mobile,
  });
  if (viewport.mobile) {
    await page.send("Emulation.setTouchEmulationEnabled", { enabled: true });
    await page.send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" });
  }
  return { page, targetId };
}

async function evaluate(page, expression) {
  const r = await page.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error("JS: " + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
  return r.result.value;
}

async function clickTarget(page, t) {
  const rect = await evaluate(page, `window.__rect(${JSON.stringify(t)})`);
  if (!rect) throw new Error("No encontré para clic: " + JSON.stringify(t));
  await sleep(120);
  const r2 = await evaluate(page, `window.__rect(${JSON.stringify(t)})`);
  const { x, y } = r2;
  await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

async function typeInto(page, t, value) {
  await clickTarget(page, t);
  await sleep(80);
  await evaluate(page, `(function(){const el=document.activeElement; if(el){el.value=""; el.dispatchEvent(new Event("input",{bubbles:true}));} return true;})()`);
  await page.send("Input.insertText", { text: value });
}

async function runActions(page, actions = []) {
  for (const a of actions) {
    if (a.type === "click") await clickTarget(page, a);
    else if (a.type === "type") await typeInto(page, a, a.value);
    else if (a.type === "hover") {
      const r = await evaluate(page, `window.__rect(${JSON.stringify(a)})`);
      if (r) await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: r.x, y: r.y });
    } else if (a.type === "scroll") {
      await evaluate(page, `(function(){const el=window.__find(${JSON.stringify(a)}); if(el) el.scrollIntoView({block:"center"}); return !!el;})()`);
    } else if (a.type === "key") {
      await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: a.key, code: a.key, windowsVirtualKeyCode: a.keyCode ?? 0 });
      await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: a.key, code: a.key, windowsVirtualKeyCode: a.keyCode ?? 0 });
    } else if (a.type === "eval") await evaluate(page, a.js);
    await sleep(a.wait ?? 450);
  }
}

async function shoot(browser, shot) {
  const viewport = shot.mobile ? { width: 390, height: 844, mobile: true } : { width: 1440, height: shot.height ?? 900 };
  const { page, targetId } = await newPage(browser, viewport);
  try {
    await page.send("Network.clearBrowserCookies");
    const session = shot.as === "none" ? null : sessions[shot.as ?? shot.role];
    if (!session && shot.as && shot.as !== "none") console.log("  (sin alumno para " + shot.as + ", se usa sin sesión)");
    if (session) {
      await page.send("Network.setCookie", { name: "session", value: session.token, url: BASE, path: "/" });
    }
    const url = BASE + (typeof shot.path === "function" ? shot.path(data) : shot.path);
    const loaded = page.once("Page.loadEventFired");
    await page.send("Page.navigate", { url });
    await loaded;
    await evaluate(page, HELPERS);
    // Fuentes + animaciones de entrada (.anim-rise 0.28s + retardos)
    await evaluate(page, "document.fonts.ready.then(()=>true)");
    await sleep(shot.settle ?? 900);
    await runActions(page, shot.actions);
    await evaluate(page, HELPERS);
    if (shot.scrollTo) await evaluate(page, `(function(){const el=window.__find(${JSON.stringify(shot.scrollTo)}); if(el) el.scrollIntoView({block:"center"}); return !!el;})()`);
    await sleep(250);
    let status = [];
    if (shot.hl?.length) status = await evaluate(page, `window.__hl(${JSON.stringify(shot.hl)})`);
    await sleep(150);
    const { data: b64 } = await page.send("Page.captureScreenshot", { format: "jpeg", quality: 78 });
    fs.writeFileSync(path.join(OUT, `${shot.id}.jpg`), Buffer.from(b64, "base64"));
    const missing = status.filter((s) => s !== "OK");
    console.log(`${missing.length ? "⚠" : "✓"} ${shot.id}${missing.length ? "  " + missing.join(", ") : ""}`);
    return missing.length === 0;
  } catch (err) {
    console.log(`✗ ${shot.id}: ${err.message}`);
    return false;
  } finally {
    await browser.send("Target.closeTarget", { targetId }).catch(() => {});
    page.ws.close();
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

(async () => {
  const shots = require("./guide-shots.manifest.cjs")(data);
  fs.mkdirSync(OUT, { recursive: true });
  const { proc, wsUrl, profile } = await launchChrome();
  const browser = await connect(wsUrl);
  let ok = 0;
  let bad = 0;
  try {
    for (const shot of shots) {
      if (ONLY && !shot.id.startsWith(ONLY)) continue;
      (await shoot(browser, shot)) ? ok++ : bad++;
    }
  } finally {
    await browser.send("Browser.close").catch(() => {});
    proc.kill();
    setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 500);
  }
  console.log(`\n${ok} capturas OK · ${bad} con avisos → ${OUT}`);
  process.exit(bad ? 1 : 0);
})();
