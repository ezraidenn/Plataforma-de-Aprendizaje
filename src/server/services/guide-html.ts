import "server-only";
import fs from "node:fs";
import path from "node:path";
import { GUIDES, KIND_COLORS, SECTION_COLORS, type GuideRole } from "@/content/guide";
import { MOBILE_SHOTS } from "@/content/guide/shots";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Captura real del paso como data URL (o null si no existe). */
function shotDataUrl(id: string): string | null {
  try {
    const file = path.join(process.cwd(), "public", "guide", `${id}.jpg`);
    if (!fs.existsSync(file)) return null;
    return `data:image/jpeg;base64,${fs.readFileSync(file).toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * Guía de uso como HTML autocontenido (sin recursos externos): se abre en
 * cualquier navegador, se imprime o se manda por correo interno. Incluye las
 * mismas capturas reales (con remarcados) que la guía dentro de la app.
 */
export function renderGuideHtml(role: GuideRole, platformName: string): string {
  const guide = GUIDES[role];
  const date = new Date().toLocaleDateString("es-MX", { year: "numeric", month: "long", day: "numeric" });

  const toc = guide.sections
    .map((s, i) => {
      const c = SECTION_COLORS[s.section] ?? SECTION_COLORS.admin;
      return `<a class="toc" href="#${esc(s.id)}" style="--c:${c.main};--cs:${c.strong};--soft:${c.soft}"><span class="n">${i + 1}</span><span>${esc(s.title)}</span></a>`;
    })
    .join("");

  const sections = guide.sections
    .map((s, i) => {
      const c = SECTION_COLORS[s.section] ?? SECTION_COLORS.admin;
      const steps = s.steps
        .map((st, j) => {
          const kind = st.kind ? KIND_COLORS[st.kind] : null;
          const chip = kind
            ? `<span class="kind" style="--k:${kind.main};--kt:${kind.tint}"><b>${kind.glyph}</b>${esc(kind.label)}</span>`
            : "";
          const ui = st.ui?.length
            ? `<div class="ui">${st.ui.map((u) => `<span>${esc(u)}</span>`).join("")}</div>`
            : "";
          const tip = st.tip ? `<div class="tip">💡 ${esc(st.tip)}</div>` : "";
          const id = `${role}-${s.id}-${j + 1}`;
          const src = shotDataUrl(id);
          const shot = src
            ? `<figure class="shot ${MOBILE_SHOTS.has(id) ? "mobile" : ""}"><img src="${src}" alt="Captura: ${esc(st.title)}"><figcaption>Captura real de la plataforma · ${esc(st.title)}</figcaption></figure>`
            : "";
          return `<li class="step"><div class="num">${j + 1}</div><div class="body"><h3>${esc(st.title)} ${chip}</h3><p>${esc(st.text)}</p>${ui}${shot}${tip}</div></li>`;
        })
        .join("");
      return `<section id="${esc(s.id)}" style="--c:${c.main};--cs:${c.strong};--soft:${c.soft}">
  <header><span class="badge">${i + 1}</span><div><h2>${esc(s.title)}</h2><p class="intro">${esc(s.intro)}</p></div></header>
  <ol class="steps">${steps}</ol>
</section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Guía de uso · ${esc(guide.label)} · ${esc(platformName)}</title>
<style>
  :root { --ink:#0f172a; --muted:#64748b; --line:#e2e8f0; --bg:#f8fafc; }
  * { box-sizing:border-box; }
  body { margin:0; font-family: "Segoe UI", Inter, system-ui, -apple-system, sans-serif; color:var(--ink); background:var(--bg); line-height:1.55; }
  .hero { background: linear-gradient(120deg,#0f172a,#1e1b4b 60%,#312e81); color:#fff; padding:48px 24px 40px; }
  .wrap { max-width: 960px; margin: 0 auto; }
  .hero .eyebrow { text-transform:uppercase; letter-spacing:.14em; font-size:12px; font-weight:700; opacity:.75; }
  .hero h1 { font-size: clamp(28px, 4vw, 40px); margin:.2em 0 .2em; letter-spacing:-.01em; }
  .hero p { margin:0; font-size:17px; opacity:.9; }
  .hero .meta { margin-top:18px; font-size:13px; opacity:.7; }
  nav.tocs { display:grid; grid-template-columns: repeat(auto-fill, minmax(220px,1fr)); gap:10px; margin: -22px auto 28px; padding:0 24px; }
  .toc { display:flex; align-items:center; gap:10px; background:#fff; border:1px solid var(--line); border-left:4px solid var(--c); border-radius:12px; padding:10px 12px; text-decoration:none; color:var(--ink); font-weight:600; font-size:14px; box-shadow:0 6px 18px -12px rgba(15,23,42,.25); }
  .toc .n { display:inline-grid; place-items:center; width:26px; height:26px; border-radius:8px; background:var(--soft); color:var(--cs); font-size:12px; }
  main { padding: 0 24px 56px; }
  section { background:#fff; border:1px solid var(--line); border-radius:18px; margin:0 auto 22px; overflow:hidden; max-width:960px; }
  section header { display:flex; gap:16px; padding:18px 22px; background:linear-gradient(100deg,var(--cs),var(--c)); color:#fff; align-items:flex-start; }
  section header .badge { flex:none; display:grid; place-items:center; width:38px; height:38px; border-radius:12px; background:rgba(255,255,255,.18); font-weight:800; font-size:16px; }
  section h2 { margin:0; font-size:20px; }
  .intro { margin:4px 0 0; opacity:.92; font-size:14.5px; }
  ol.steps { list-style:none; margin:0; padding: 8px 22px 18px; }
  .step { display:flex; gap:14px; padding:16px 0; border-top:1px solid var(--line); }
  .step:first-child { border-top:0; }
  .num { flex:none; width:30px; height:30px; border-radius:50%; background:var(--soft); color:var(--cs); font-weight:800; display:grid; place-items:center; font-size:13px; margin-top:2px; }
  .body { min-width:0; flex:1; }
  .body h3 { margin:0 0 4px; font-size:16px; display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
  .body p { margin:0; color:#334155; font-size:15px; }
  .kind { display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:600; color:var(--k); background:var(--kt); padding:2px 8px 2px 4px; border-radius:999px; }
  .kind b { display:inline-grid; place-items:center; width:20px; height:20px; border-radius:6px; background:#fff; font-size:12px; }
  .ui { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
  .ui span { font-size:12px; font-weight:600; border:1px solid var(--line); border-radius:8px; padding:3px 8px; background:#f8fafc; color:#334155; }
  .tip { margin-top:10px; background:#fffbeb; border:1px solid #fde68a; color:#92400e; border-radius:10px; padding:8px 12px; font-size:13.5px; }
  .shot { margin:12px 0 0; } .shot.mobile { max-width:300px; }
  .shot img { width:100%; height:auto; border:1px solid var(--line); border-radius:12px; box-shadow:0 10px 30px -18px rgba(15,23,42,.45); }
  .shot figcaption { font-size:11.5px; color:var(--muted); margin-top:6px; }
  footer { text-align:center; color:var(--muted); font-size:12.5px; padding:0 24px 40px; }
  @media print { .hero{ -webkit-print-color-adjust:exact; print-color-adjust:exact; } section{ break-inside:avoid; } .step{ break-inside:avoid; } nav.tocs{ display:none; } }
</style>
</head>
<body>
<div class="hero"><div class="wrap">
  <div class="eyebrow">Guía de uso · ${esc(platformName)}</div>
  <h1>${esc(guide.label)}</h1>
  <p>${esc(guide.tagline)}</p>
  <div class="meta">Generada el ${esc(date)} · Paso a paso, con capturas reales de la plataforma</div>
</div></div>
<nav class="tocs wrap">${toc}</nav>
<main>
${sections}
</main>
<footer>${esc(platformName)} · Esta guía se generó desde la plataforma (Ajustes → Guía de uso → Descargar).</footer>
</body>
</html>`;
}
