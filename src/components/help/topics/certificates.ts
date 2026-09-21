import type { TemplateFieldKey } from "../scenes/certificates.story";
import type { TopicsOf } from "./types";

export type CertificatesValues = {
  "templates.fields": { field: TemplateFieldKey };
};

export const CERTIFICATES_TOPICS: TopicsOf<CertificatesValues> = {
  "templates.fields": {
    label: "Campos «Vigencia» y «Código QR»",
    where: "Certificados › Plantilla",
    kicker: "En el certificado",
    caption: ({ field }) =>
      field === "validity"
        ? "El campo **Vigencia** imprime «Vigente hasta …» con la fecha del curso; en certificados **vitalicios se omite** solo."
        : "Al escanear el **código QR** con un celular se abre la verificación: **«Certificado válido»** con nombre, curso y folio.",
    example: { field: "qr" },
  },
};
