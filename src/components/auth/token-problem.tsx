import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const TEXT = {
  invalido: "El enlace no es válido o ya fue reemplazado por uno más reciente. Revisa el último correo que te llegó o pide uno nuevo.",
  usado: "Este enlace ya se usó. Entra con la contraseña que elegiste; si no la recuerdas, pide uno nuevo.",
  vencido: "El enlace venció. Pide uno nuevo: llega en unos minutos.",
} as const;

export function TokenProblem({ reason }: { reason: keyof typeof TEXT }) {
  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex gap-3 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
          <p>{TEXT[reason]}</p>
        </div>
        <Button asChild className="h-11 w-full bg-cta text-cta-foreground hover:bg-cta/90">
          <Link href="/recuperar">Pedir un enlace nuevo</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
