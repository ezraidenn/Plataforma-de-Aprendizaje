import fs from "node:fs";
import path from "node:path";
import { BookOpenCheck } from "lucide-react";
import { requireUser } from "@/server/auth/guards";
import { guidesFor } from "@/content/guide";
import { PageHeader } from "@/components/shell/page-header";
import { GuideView } from "@/components/guide/guide-view";

export const metadata = { title: "Guía de uso" };

/** Capturas reales disponibles (public/guide/<id>.jpg, ver scripts/guide-shots.cjs). */
function availableShots(): string[] {
  try {
    return fs
      .readdirSync(path.join(process.cwd(), "public", "guide"))
      .filter((f) => f.endsWith(".jpg"))
      .map((f) => f.replace(/\.jpg$/, ""));
  } catch {
    return [];
  }
}

export default async function GuiaPage() {
  const user = await requireUser();
  const guides = guidesFor(user.role);
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Cuenta"
        title="Guía de uso"
        description="Paso a paso con capturas reales de la plataforma y el elemento de cada paso remarcado. Puedes descargarla como página HTML para compartirla o imprimirla."
        icon={BookOpenCheck}
      />
      <GuideView guides={guides} shots={availableShots()} />
    </div>
  );
}
