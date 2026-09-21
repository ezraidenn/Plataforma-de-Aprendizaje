import Link from "next/link";
import { BookOpenText, ChevronRight, LogOut } from "lucide-react";
import { logoutAction } from "@/server/auth/actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/** Tarjetas de /ajustes sin estado: enlace a la guía y cierre de sesión (server-safe). */
export function GuideLinkCard({ className }: { className?: string }) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-heading text-base">
          <span className="flex size-7 items-center justify-center rounded-md bg-section-soft text-section-strong">
            <BookOpenText className="size-4" aria-hidden />
          </span>
          Guía de uso
        </CardTitle>
        <CardDescription>
          Pasos de cada pantalla según tu rol, con enlaces directos a donde se hace cada cosa.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline" className="h-11">
          <Link href="/guia">
            Abrir la guía
            <ChevronRight className="size-4" aria-hidden />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export function SessionCard({ className }: { className?: string }) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-heading text-base">
          <span className="flex size-7 items-center justify-center rounded-md bg-section-soft text-section-strong">
            <LogOut className="size-4" aria-hidden />
          </span>
          Sesión
        </CardTitle>
        <CardDescription>Cierra tu sesión en este dispositivo.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={logoutAction}>
          <Button type="submit" variant="outline" className="h-11">
            <LogOut className="size-4" aria-hidden />
            Cerrar sesión
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
