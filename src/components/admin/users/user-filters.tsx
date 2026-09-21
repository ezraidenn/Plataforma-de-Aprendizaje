"use client";

import { useRouter } from "next/navigation";
import Form from "next/form";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ROLE_OPTIONS = [
  { value: "all", label: "Todos los roles" },
  { value: "admin", label: "Administradores" },
  { value: "teacher", label: "Maestros" },
  { value: "student", label: "Estudiantes" },
] as const;

/** Búsqueda (GET) + filtro por rol vía searchParams; cambiar el filtro reinicia la página. */
export function UserFilters({ q, role }: { q: string; role: string }) {
  const router = useRouter();

  function applyRole(next: string) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (next !== "all") params.set("role", next);
    const qs = params.toString();
    router.push(`/admin/users${qs ? `?${qs}` : ""}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Form action="/admin/users" className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Buscar por nombre o correo…"
          className="h-11 w-64 pl-9"
          aria-label="Buscar usuarios"
        />
        {role !== "all" && <input type="hidden" name="role" value={role} />}
      </Form>
      <Select value={role} onValueChange={applyRole}>
        <SelectTrigger
          className="w-48 data-[size=default]:h-11"
          aria-label="Filtrar por rol"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ROLE_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
