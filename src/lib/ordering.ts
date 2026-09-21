/**
 * «Ordenar pasos»: matemática pura (sin BD ni DOM), compartida por el servidor
 * y las pruebas.
 */

/**
 * Fracción de pares consecutivos bien ordenados (0–1). `order` es el orden del
 * alumno expresado con los índices originales de los pasos: [1, 2, 3, 0]
 * significa que puso primero el paso 2, luego el 3… Cada par (i, i+1) del
 * orden correcto cuenta si el alumno dejó el paso i+1 justo después del i.
 * Así, un paso fuera de lugar solo quita los pares que rompe.
 */
export function orderingScore(order: number[]): number {
  const n = order.length;
  if (n < 2) return 0;
  const position = new Map(order.map((step, pos) => [step, pos]));
  let hits = 0;
  for (let i = 0; i < n - 1; i++) {
    const a = position.get(i);
    const b = position.get(i + 1);
    if (a !== undefined && b !== undefined && b === a + 1) hits++;
  }
  return hits / (n - 1);
}

/**
 * Índices 0…n−1 revueltos (Fisher–Yates) que nunca quedan en el orden
 * correcto: si el azar lo deja igual, se rota un lugar.
 */
export function shuffledOrder(n: number, random: () => number = Math.random): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (n > 1 && order.every((v, i) => v === i)) order.push(order.shift()!);
  return order;
}
