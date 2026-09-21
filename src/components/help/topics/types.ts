/** Un tema de la ayuda visual: nombre, dónde está, textos y valor de ejemplo. */
export type Topic<V> = {
  /** Nombre del ajuste (aria-label del «?» y título en el catálogo) */
  label: string;
  /** Pantalla donde está (catálogo) */
  where: string;
  /** Encabezado de la tarjeta */
  kicker: string;
  /** Frase de 1–2 líneas con el valor actual; **negritas** con dobles asteriscos */
  caption: (value: V) => string;
  /** Valor de ejemplo (catálogo y cuando la pantalla no pasa uno) */
  example: V;
};

/** Temas de un área a partir de su mapa tema → valor. */
export type TopicsOf<M> = { [K in keyof M]: Topic<M[K]> };

/** Tema cuya escena no depende de ningún ajuste. */
export type NoValue = Record<string, never>;
