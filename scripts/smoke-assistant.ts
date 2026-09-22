/**
 * Asistente de IA, sin gastar en la API: placeholder por ruta, cliente con
 * herramientas (OpenAI simulada), catálogo por rol, bucle del agente,
 * matrícula instantánea con deshacer, propuesta → editar → aplicar,
 * conversaciones e historial. Datos con prefijo «zasst», borrados al final.
 *
 * Uso: pnpm smoke:assistant
 */
import { placeholderFor } from "../src/lib/assistant-placeholder";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  }
}

function placeholderChecks() {
  console.log("\n— Texto del campo según la ruta");
  check("Inicio", placeholderFor("/teach/dashboard") === "Habla con la IA o suelta un archivo");
  check("Estudiantes", placeholderFor("/teach/students") === "Habla con la IA o suelta aquí la lista de alumnos");
  check("Cursos", placeholderFor("/teach/courses") === "Habla con la IA o suelta la lista de cursos");
  check("Dentro de un curso", placeholderFor("/teach/courses/abc123/content") === "Habla con la IA sobre este curso");
  check("Perfil de alumno", placeholderFor("/teach/students/xyz") === "Habla con la IA sobre este alumno");
  check("Otra ruta", placeholderFor("/admin/users") === "Habla con la IA o suelta un archivo");
}

async function main() {
  placeholderChecks();
  console.log(failures === 0 ? "\nTodo bien" : `\n${failures} fallo(s)`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
