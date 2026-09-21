import type { ContentKind } from "@/components/kind-meta";
import type { SectionKey } from "@/components/shell/sections";

/** Un paso de la guía: "primero… luego…". */
export type GuideStep = {
  title: string;
  text: string;
  /** Consejo opcional en recuadro. */
  tip?: string;
  /** Enlace directo a la pantalla real (solo dentro de la app). */
  href?: string;
  hrefLabel?: string;
  /** Muestra el chip de tipo de contenido real. */
  kind?: ContentKind;
  /** Etiquetas de estado/botón que verá el usuario ("Publicar", "Entregar"). */
  ui?: string[];
  /**
   * Escena animada del paso (clave de GUIDE_SCENES). Por convención es el id
   * del paso: `${rol}-${sección}-${n}`, el mismo de su captura.
   */
  scene?: string;
};

export type GuideSection = {
  id: string;
  title: string;
  intro: string;
  /** Color de la sección de la app donde ocurre (tiñe la tarjeta). */
  section: SectionKey;
  steps: GuideStep[];
};

export type GuideRole = "teacher" | "student" | "admin";

export type RoleGuide = {
  role: GuideRole;
  label: string;
  tagline: string;
  sections: GuideSection[];
};
