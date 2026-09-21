// Genera docs/usuarios-prueba.html con los usuarios actuales y sus contraseñas
// de prueba conocidas (seed). Uso: node scripts/usuarios-prueba.cjs
const Database = require("better-sqlite3");
const fs = require("node:fs");
const path = require("node:path");

const db = new Database(path.join(process.cwd(), "data", "data.db"), { readonly: true });
const users = db
  .prepare("SELECT full_name, email, role, active FROM users ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'teacher' THEN 1 ELSE 2 END, full_name")
  .all();
const platform = db.prepare("SELECT value FROM app_settings WHERE key = 'platform_name'").get()?.value ?? "Plataforma";

// Contraseñas conocidas de los seeds (scripts/seed.ts y scripts/seed-demo.ts)
const KNOWN = {
  "admin@empresa.local": "admin1234",
  "maestro@empresa.local": "maestro1234",
  "estudiante@empresa.local": "estudiante1234",
};
function passwordFor(u) {
  if (KNOWN[u.email]) return KNOWN[u.email];
  // Estudiantes demo del seed hiperrealista: nombre.apellido@empresa.local
  if (u.role === "student" && /^[a-z]+\.[a-z]+@empresa\.local$/.test(u.email)) return "demo1234";
  return null;
}

const ROLE = { admin: "Administrador", teacher: "Maestro", student: "Estudiante" };
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

const rows = users
  .map((u) => {
    const pwd = passwordFor(u);
    return `<tr data-role="${u.role}">
  <td><span class="role ${u.role}">${ROLE[u.role]}</span></td>
  <td class="name">${esc(u.full_name)}${u.active ? "" : ' <span class="off">inactivo</span>'}</td>
  <td><code>${esc(u.email)}</code> <button class="cp" data-copy="${esc(u.email)}" title="Copiar correo">⧉</button></td>
  <td>${pwd ? `<code>${esc(pwd)}</code> <button class="cp" data-copy="${esc(pwd)}" title="Copiar contraseña">⧉</button>` : '<span class="unk">desconocida · restablecer en Admin → Usuarios</span>'}</td>
  <td>${pwd ? `<button class="cp both" data-copy="${esc(u.email)}\t${esc(pwd)}" title="Copiar correo y contraseña">Copiar ambos</button>` : ""}</td>
</tr>`;
  })
  .join("\n");

const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Usuarios de prueba · ${esc(platform)}</title>
<style>
  body{font-family:Segoe UI,Inter,system-ui,sans-serif;margin:0;background:#f8fafc;color:#0f172a}
  header{background:linear-gradient(120deg,#0f172a,#1e1b4b);color:#fff;padding:22px 28px}
  header h1{margin:0;font-size:20px} header p{margin:6px 0 0;color:#cbd5e1;font-size:13px}
  main{padding:20px 28px;max-width:1100px}
  .bar{display:flex;gap:10px;align-items:center;margin-bottom:12px;flex-wrap:wrap}
  input[type=search]{flex:1;min-width:220px;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px}
  .chip{border:1px solid #cbd5e1;background:#fff;border-radius:999px;padding:5px 12px;font-size:13px;cursor:pointer}
  .chip.on{background:#1e1b4b;color:#fff;border-color:#1e1b4b}
  table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden}
  th,td{padding:9px 10px;border-bottom:1px solid #eef2f7;text-align:left;font-size:14px;vertical-align:middle}
  th{background:#f1f5f9;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#475569}
  code{background:#f1f5f9;padding:2px 6px;border-radius:6px;font-size:13px}
  .cp{border:1px solid #cbd5e1;background:#fff;border-radius:6px;padding:3px 7px;cursor:pointer;font-size:12px;margin-left:4px}
  .cp:hover{background:#eef2ff;border-color:#818cf8} .cp.ok{background:#dcfce7;border-color:#22c55e}
  .both{padding:4px 10px}
  .role{font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px}
  .role.admin{background:#f1f5f9;color:#334155}.role.teacher{background:#e0f2fe;color:#0369a1}.role.student{background:#d1fae5;color:#047857}
  .unk{color:#b45309;font-size:12px} .off{color:#dc2626;font-size:11px;font-weight:600}
  .hint{color:#64748b;font-size:12px;margin-top:10px}
  tr.hide{display:none}
</style></head><body>
<header><h1>Usuarios de prueba · ${esc(platform)}</h1><p>Generado el ${new Date().toLocaleString("es-MX")} desde la base de datos · ${users.length} usuarios · Solo para pruebas en red local</p></header>
<main>
  <div class="bar">
    <input type="search" id="q" placeholder="Buscar nombre o correo…" aria-label="Buscar">
    <button class="chip on" data-f="all">Todos</button>
    <button class="chip" data-f="admin">Admin</button>
    <button class="chip" data-f="teacher">Maestros</button>
    <button class="chip" data-f="student">Estudiantes</button>
  </div>
  <table><thead><tr><th>Rol</th><th>Nombre</th><th>Correo</th><th>Contraseña</th><th></th></tr></thead>
  <tbody>${rows}</tbody></table>
  <p class="hint">Los estudiantes del seed demo usan <code>demo1234</code>. Las cuentas creadas a mano o por CSV tienen contraseña temporal propia: si no la tienes, restablécela desde Admin → Usuarios (o Estudiantes → menú del alumno). Regenera este archivo con <code>node scripts/usuarios-prueba.cjs</code>.</p>
</main>
<script>
  function norm(s){return s.normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").toLowerCase()}
  const rows=[...document.querySelectorAll("tbody tr")];let filter="all";
  function apply(){const q=norm(document.getElementById("q").value);rows.forEach(r=>{const ok=(filter==="all"||r.dataset.role===filter)&&(!q||norm(r.textContent).includes(q));r.classList.toggle("hide",!ok)})}
  document.getElementById("q").addEventListener("input",apply);
  document.querySelectorAll(".chip").forEach(b=>b.addEventListener("click",()=>{filter=b.dataset.f;document.querySelectorAll(".chip").forEach(c=>c.classList.toggle("on",c===b));apply()}));
  document.querySelectorAll(".cp").forEach(b=>b.addEventListener("click",async()=>{
    const t=b.dataset.copy;try{await navigator.clipboard.writeText(t)}catch{const ta=document.createElement("textarea");ta.value=t;document.body.appendChild(ta);ta.select();document.execCommand("copy");ta.remove()}
    const prev=b.textContent;b.textContent="✓";b.classList.add("ok");setTimeout(()=>{b.textContent=prev;b.classList.remove("ok")},900)}));
</script>
</body></html>`;

fs.mkdirSync(path.join(process.cwd(), "docs"), { recursive: true });
const out = path.join(process.cwd(), "docs", "usuarios-prueba.html");
fs.writeFileSync(out, html);
console.log(`✓ ${out} (${users.length} usuarios)`);
