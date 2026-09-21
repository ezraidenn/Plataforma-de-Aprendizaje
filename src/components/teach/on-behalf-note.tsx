"use client";

import { UserRound } from "lucide-react";
import { useViewContext } from "@/components/shell/view-context";

/** En «Ver como maestro», avisa a nombre de quién quedará lo que se crea. */
export function OnBehalfNote({ subject, plural = false }: { subject: string; plural?: boolean }) {
  const info = useViewContext();
  if (info.kind !== "teacher") return null;
  return (
    <p className="flex items-start gap-2 rounded-lg border border-primary/20 bg-brand-tint px-3 py-2 text-sm text-primary">
      <UserRound className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        {subject} {plural ? "se crearán" : "se creará"} a nombre de <strong>{info.ownerName}</strong>.
      </span>
    </p>
  );
}
