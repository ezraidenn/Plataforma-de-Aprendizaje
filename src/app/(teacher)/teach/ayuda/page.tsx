import type { Metadata } from "next";
import { Sparkles } from "lucide-react";
import { requireTeacher } from "@/server/auth/guards";
import { PageHeader } from "@/components/shell/page-header";
import { HelpCatalog } from "@/components/help/catalog";

export const metadata: Metadata = { title: "Ayuda visual" };

export default async function HelpCatalogPage() {
  await requireTeacher();
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Guía"
        title="Ayuda visual"
        description="Qué mueve cada ajuste, en animación. Es lo mismo que aparece al pasar el cursor por el «?» junto a cada ajuste."
        icon={Sparkles}
      />
      <HelpCatalog />
    </div>
  );
}
