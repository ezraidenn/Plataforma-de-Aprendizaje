"use client";

import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { auditEntityLabel } from "@/components/admin/format";

/** Filtro por entidad del registro de auditoría; cambiarlo reinicia la página. */
export function AuditEntityFilter({
  entities,
  value,
}: {
  entities: string[];
  value: string;
}) {
  const router = useRouter();

  function apply(next: string) {
    const params = new URLSearchParams();
    if (next !== "all") params.set("entity", next);
    const qs = params.toString();
    router.push(`/admin/settings${qs ? `?${qs}` : ""}#auditoria`);
  }

  return (
    <Select value={value || "all"} onValueChange={apply}>
      <SelectTrigger className="w-48" aria-label="Filtrar auditoría por entidad">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Todas las entidades</SelectItem>
        {entities.map((entity) => (
          <SelectItem key={entity} value={entity}>
            {auditEntityLabel(entity)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
