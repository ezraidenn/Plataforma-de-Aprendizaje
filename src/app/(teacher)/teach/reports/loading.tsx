import { Skeleton } from "@/components/ui/skeleton";

export default function ReportsLoading() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-11 w-64 rounded-lg" />
        <Skeleton className="ml-auto h-11 w-56 rounded-lg" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-11 w-72 rounded-lg" />
        <Skeleton className="h-11 w-40 rounded-lg" />
      </div>
      <div className="space-y-2 rounded-xl border bg-card p-4">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="h-11 rounded-lg" />
        ))}
      </div>
    </div>
  );
}
