/**
 * La pista bajo la foto del editor de «arrastrar a la imagen», según lo que
 * está pasando. Con un puntero táctil (`touch`) no se habla de Mayús, Ctrl ni
 * Supr: ahí no hay selección múltiple, y deshacer está en sus botones.
 */
export function dragEditorHint({
  removing,
  placing,
  empty,
  selectedCount,
  touch,
}: {
  /** Un lugar arrastrado fuera de la foto. */
  removing: boolean;
  /** El nombre del elemento que se está colocando, si hay. */
  placing: string | null;
  /** Aún no hay elementos. */
  empty: boolean;
  selectedCount: number;
  touch: boolean;
}): string {
  if (removing) return "Fuera de la foto: suéltalo para quitar este lugar.";
  if (placing) {
    return touch
      ? `Toca la foto donde va «${placing}» (pulsa otra vez «Colocar» para cancelar).`
      : `Haz clic en la foto donde va «${placing}» (Esc para cancelar).`;
  }
  if (empty) return "Primero agrega los íconos o etiquetas que el alumno colocará.";
  if (touch) {
    return selectedCount > 1
      ? `${selectedCount} lugares seleccionados: arrastra uno para moverlos juntos.`
      : "Arrastra un elemento de la lista a la foto para marcar dónde va (o pulsa «Colocar» y toca la foto). Toca un lugar para elegirlo y arrástralo para moverlo; sácalo de la foto para quitarlo. Deshacer y Rehacer están arriba.";
  }
  return selectedCount > 1
    ? `${selectedCount} lugares seleccionados: arrástralos juntos o muévelos con las flechas (Mayús: pasos largos). Ctrl+D los duplica, Supr los quita y Esc suelta la selección.`
    : "Arrastra un elemento de la lista a la foto para marcar dónde va (o pulsa su botón «Colocar», la mira, y haz clic en la foto). Clic en un lugar lo selecciona; Mayús+clic o un recuadro sobre la foto seleccionan varios. Arrástralos o usa las flechas para moverlos; Ctrl+D duplica, Supr quita (o saca un lugar de la foto) y Ctrl+Z deshace.";
}
