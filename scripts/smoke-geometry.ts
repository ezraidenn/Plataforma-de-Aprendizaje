// Prueba rápida de la geometría del editor de constancias (sin servidor).
import {
  alignDeltas,
  computeSnap,
  distributeDeltas,
  fieldBox,
  measures,
} from "../src/components/teach/templates/canvas-geometry";

let failed = 0;
function check(name: string, ok: boolean, extra?: unknown) {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : " " + JSON.stringify(extra)}`);
  if (!ok) failed++;
}

const pageW = 792;
const pageH = 612;

// Caja centrada: x es el centro
const c = fieldBox({ x: 396, y: 100, align: "center", width: 200, height: 20 });
check("fieldBox center", c.left === 296 && c.right === 496 && c.cx === 396);
const r = fieldBox({ x: 700, y: 100, align: "right", width: 100, height: 20 });
check("fieldBox right", r.left === 600 && r.right === 700);

// Snap al centro de página cuando el centro está a 4 pt
const moving = fieldBox({ x: 400, y: 100, align: "center", width: 200, height: 20 });
const s1 = computeSnap({ moving, others: [], pageW, pageH, margin: 36, tolerance: 6 });
check("snap centro de página", Math.abs(s1.dx + 4) < 1e-9 && s1.guides.some((g) => g.kind === "center"), s1);

// Snap al borde izquierdo de otro campo (QR) a 5 pt
const qr = fieldBox({ x: 100, y: 300, align: "left", width: 80, height: 80 });
const txt = fieldBox({ x: 105, y: 400, align: "left", width: 100, height: 14 });
const s2 = computeSnap({ moving: txt, others: [qr], pageW, pageH, margin: 36, tolerance: 6 });
check("snap borde de otro campo", Math.abs(s2.dx + 5) < 1e-9 && s2.guides.some((g) => g.kind === "edge"), s2);

// Fuera de tolerancia: sin snap
const far = fieldBox({ x: 130, y: 400, align: "left", width: 150, height: 14 });
const s3 = computeSnap({ moving: far, others: [qr], pageW, pageH, margin: 36, tolerance: 6 });
check("sin snap lejos", s3.dx === 0 && s3.dy === 0 && s3.guides.length === 0, s3);

// Separación igual entre dos vecinos (simetría horizontal)
const a = fieldBox({ x: 100, y: 200, align: "left", width: 50, height: 20 });
const b = fieldBox({ x: 400, y: 200, align: "left", width: 50, height: 20 });
// centro ideal: hueco 150..400 → gap = (250-50)/2 = 100 → left ideal 250; probamos 253
const mid = fieldBox({ x: 253, y: 200, align: "left", width: 50, height: 20 });
const s4 = computeSnap({ moving: mid, others: [a, b], pageW, pageH, margin: 36, tolerance: 6 });
check("snap separación igual", Math.abs(s4.dx + 3) < 1e-9 && s4.guides.filter((g) => g.kind === "spacing").length === 2, s4);

// Medidas: distancias a página y vecinos
const m = measures(mid, [a, b], pageW, pageH);
check("medidas 4 lados", m.length === 4 && m.some((x) => x.axis === "x" && Math.abs(x.value - 103) < 1e-9), m);

// Alinear una sola caja al centro de página
const d1 = alignDeltas([{ index: 0, rect: moving }], "hcenter", pageW, pageH, 36);
check("alinear 1 al centro", Math.abs(d1.get(0)!.dx + 4) < 1e-9);
// Alinear varias entre sí (izquierda del grupo)
const d2 = alignDeltas([{ index: 0, rect: qr }, { index: 1, rect: txt }], "left", pageW, pageH, 36);
check("alinear grupo izquierda", d2.get(0)!.dx === 0 && d2.get(1)!.dx === -5);
// Centrar QR con texto verticalmente (grupo)
const d3 = alignDeltas([{ index: 0, rect: qr }, { index: 1, rect: txt }], "vcenter", pageW, pageH, 36);
const qrCy = qr.cy + d3.get(0)!.dy;
const txtCy = txt.cy + d3.get(1)!.dy;
check("centrar vertical grupo", Math.abs(qrCy - txtCy) < 1e-9);

// Distribuir 3 cajas horizontalmente
const x1 = fieldBox({ x: 0, y: 0, align: "left", width: 50, height: 10 });
const x2 = fieldBox({ x: 70, y: 0, align: "left", width: 50, height: 10 });
const x3 = fieldBox({ x: 300, y: 0, align: "left", width: 50, height: 10 });
const dd = distributeDeltas([{ index: 0, rect: x1 }, { index: 1, rect: x2 }, { index: 2, rect: x3 }], "x");
// span 350, sizes 150 → gap 100 → x2 left ideal 150 → dx = 80
check("distribuir horizontal", dd.get(0)!.dx === 0 && dd.get(2)!.dx === 0 && Math.abs(dd.get(1)!.dx - 80) < 1e-9, [...dd]);

if (failed) {
  console.log(`\n❌ ${failed} fallas`);
  process.exit(1);
}
console.log("\n✅ GEOMETRÍA OK");
