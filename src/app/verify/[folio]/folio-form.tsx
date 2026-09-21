"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Reintento de folio: navega a /verify/[valor] (la página vuelve a validar). */
export function FolioForm() {
  const router = useRouter();
  const [folio, setFolio] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const value = folio.trim().toUpperCase();
        if (value) router.push(`/verify/${encodeURIComponent(value)}`);
      }}
      className="w-full space-y-2 text-left"
    >
      <Label htmlFor="folio">Verificar otro folio</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id="folio"
          value={folio}
          onChange={(e) => setFolio(e.target.value)}
          placeholder="CERT-2026-000123-K7QX"
          autoComplete="off"
          className="h-11 flex-1 text-base"
        />
        <Button
          type="submit"
          disabled={!folio.trim()}
          className="h-11 bg-cta text-cta-foreground hover:bg-cta/90"
        >
          <Search aria-hidden />
          Verificar
        </Button>
      </div>
    </form>
  );
}
