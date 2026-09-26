/**
 * «Clasificar en grupos»: validación, puntaje, CSV y saneo (puro); en tareas
 * siguientes, el recorrido contra la base. Datos con prefijo «zcat», borrados
 * al final.
 *
 * Uso: pnpm smoke:categorize
 */
import {
  MAX_CARDS,
  categorizeCsvRepresentable,
  categorizeProblem,
  categorizeScore,
  formatGroupsCsv,
  parseGroupsCsv,
  sanitizeCategorize,
  type CategorizeConfig,
} from "../src/lib/categorize";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  }
}

const C: CategorizeConfig = {
  groups: [{ id: "g1", name: "Frutas" }, { id: "g2", name: "Verduras" }],
  cards: [
    { id: "c1", kind: "text", text: "Manzana", groupId: "g1" },
    { id: "c2", kind: "text", text: "Pera", groupId: "g1" },
    { id: "c3", kind: "text", text: "Zanahoria", groupId: "g2" },
    { id: "c4", kind: "icon", fileId: "f-apio", ratio: 1, groupId: "g2" },
  ],
};

function pureChecks() {
  console.log("\n— Validación");
  check("Válida", categorizeProblem(C) === null, categorizeProblem(C));
  check("Config ilegible", categorizeProblem(null) === "Configura los grupos y las tarjetas");
  check("Un solo grupo", categorizeProblem({ ...C, groups: [C.groups[0]], cards: C.cards.filter((c) => c.groupId === "g1") }) === "Crea al menos dos grupos");
  check("Siete grupos", categorizeProblem({ groups: Array.from({ length: 7 }, (_, i) => ({ id: `g${i}`, name: `G${i}` })), cards: Array.from({ length: 7 }, (_, i) => ({ id: `c${i}`, kind: "text" as const, text: `T${i}`, groupId: `g${i}` })) }) === "Usa como máximo seis grupos");
  check("Grupo sin nombre", categorizeProblem({ ...C, groups: [{ id: "g1", name: " " }, C.groups[1]] }) === "Hay un grupo sin nombre");
  check("Nombres repetidos", categorizeProblem({ ...C, groups: [C.groups[0], { id: "g2", name: "frutas" }] }) === "Hay dos grupos con el mismo nombre");
  check("Grupo vacío", categorizeProblem({ ...C, cards: C.cards.filter((c) => c.groupId === "g1") }) === "El grupo «Verduras» no tiene tarjetas");
  check("Tarjeta de un grupo que no existe", categorizeProblem({ ...C, cards: [...C.cards, { id: "c9", kind: "text", text: "X", groupId: "g9" }] }) === "Hay una tarjeta de un grupo que ya no existe");
  check("Tarjeta sin texto", categorizeProblem({ ...C, cards: [...C.cards, { id: "c9", kind: "text", text: "", groupId: "g1" }] }) === "Hay una tarjeta sin texto");
  check("Ícono sin archivo", categorizeProblem({ ...C, cards: [...C.cards, { id: "c9", kind: "icon", groupId: "g1" }] }) === "Hay una tarjeta sin imagen");
  check("Tarjetas que se ven igual", categorizeProblem({ ...C, cards: [...C.cards, { id: "c9", kind: "text", text: "manzana", groupId: "g2" }] }) === "Hay dos tarjetas iguales: el alumno no las distinguiría");
  check("Demasiadas tarjetas", categorizeProblem({ ...C, cards: Array.from({ length: MAX_CARDS + 1 }, (_, i) => ({ id: `c${i}`, kind: "text" as const, text: `T${i}`, groupId: i % 2 ? "g1" : "g2" })) }) === `Usa como máximo ${MAX_CARDS} tarjetas`);
  check("Texto de tarjeta largo", categorizeProblem({ ...C, cards: [...C.cards, { id: "c9", kind: "text", text: "x".repeat(81), groupId: "g1" }] }) === "Las tarjetas deben tener como máximo 80 caracteres");

  console.log("\n— Puntaje");
  check("Todo bien: 1", categorizeScore(C, { c1: "g1", c2: "g1", c3: "g2", c4: "g2" }) === 1);
  check("Parcial por tarjeta", categorizeScore(C, { c1: "g1", c2: "g2", c3: "g2" }) === 0.5);
  check("Nada puesto: 0", categorizeScore(C, {}) === 0);

  console.log("\n— CSV");
  check("Solo texto cabe en el CSV", !categorizeCsvRepresentable(C) && categorizeCsvRepresentable({ ...C, cards: C.cards.slice(0, 3) }));
  const text = formatGroupsCsv({ ...C, cards: C.cards.slice(0, 3) });
  check("Formatear grupos", text === "Frutas: Manzana; Pera | Verduras: Zanahoria", text);
  const back = parseGroupsCsv(text);
  check("Leer grupos", !("error" in back) && back.groups.length === 2 && back.cards.length === 3 && back.cards[2].groupId === back.groups[1].id, back);
  check("Leer grupos: sin «:» es error", "error" in parseGroupsCsv("Frutas Manzana | Verduras: Zanahoria"));
  check("Leer grupos: formato tolerante a espacios", !("error" in parseGroupsCsv("  Frutas :Manzana ;  Pera|Verduras:Zanahoria ")));

  console.log("\n— Saneo");
  const s = sanitizeCategorize({ groups: [{ id: "g1", name: " Frutas ", x: 1 }], cards: [{ id: "c1", kind: "icon", fileId: "f", text: "no", ratio: 2, groupId: "g1" }, { id: "c2", kind: "text", text: " Pera ", fileId: "x", groupId: "g1" }] }) as CategorizeConfig;
  check("Saneo: recorta, quita lo que no corresponde a cada clase", JSON.stringify(s) === JSON.stringify({ groups: [{ id: "g1", name: "Frutas" }], cards: [{ id: "c1", kind: "icon", fileId: "f", ratio: 2, groupId: "g1" }, { id: "c2", kind: "text", text: "Pera", groupId: "g1" }] }), s);
}

async function main() {
  pureChecks();
  console.log(failures === 0 ? "\nTodo bien" : `\n${failures} fallo(s)`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
