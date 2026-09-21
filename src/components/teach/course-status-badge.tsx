import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { COURSE_STATUS_LABEL } from "./format";

export function CourseStatusBadge({
  status,
  className,
}: {
  status: "draft" | "published" | "archived";
  className?: string;
}) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        status === "published" && "bg-cta/10 text-cta",
        status === "archived" && "bg-muted text-muted-foreground",
        className
      )}
    >
      {COURSE_STATUS_LABEL[status]}
    </Badge>
  );
}
