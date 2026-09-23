import "server-only";
import { panoramaQuery } from "../queries";
import { schema, str, type AssistantTool } from "../tool-types";
import { resultBlocks } from "./consulta-comun";

/**
 * Cómo va cada maestro. Es la vista del administrador y no tiene filtros: solo
 * responde en el contexto «General — todos», porque en otro contexto sería
 * enseñar por la puerta de atrás lo que ese contexto esconde.
 */
export const panorama: AssistantTool = {
  name: "panorama",
  description:
    "Panorama de la plataforma: una fila por maestro con sus cursos, alumnos, certificados y último acceso. Solo funciona en el contexto «General — todos».",
  // El esquema estricto exige al menos una propiedad; esta no se usa
  parameters: schema({ periodo: str('No se usa; manda «»') }),
  roles: ["admin"],
  risk: "read",
  run(_params, ctx) {
    if (ctx.scope.kind !== "all") {
      return {
        forModel:
          "El panorama solo se ve en el contexto «General — todos»; ahora hay otro contexto elegido. Pide al usuario que lo cambie arriba y vuelve a pedírmelo.",
        blocks: [{ type: "links", links: [{ label: "Ir al inicio", href: "/teach/dashboard", icon: "page" }] }],
      };
    }
    return resultBlocks(panoramaQuery(), ctx, "panorama");
  },
};
