/** Dueño de un curso/plantilla en la vista «General». */
export function OwnerTag({ name, self = false }: { name: string; self?: boolean }) {
  return (
    <span className="inline-flex max-w-full items-center truncate rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
      {self ? "Tú" : name}
    </span>
  );
}
