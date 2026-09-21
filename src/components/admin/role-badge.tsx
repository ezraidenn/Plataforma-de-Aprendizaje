import { Badge } from "@/components/ui/badge";
import { ROLE_LABEL } from "./format";

/** Badge de rol: admin = marca (índigo), maestro = secundario, estudiante = contorno. */
export function RoleBadge({ role }: { role: "admin" | "teacher" | "student" }) {
  if (role === "admin") {
    return (
      <Badge variant="secondary" className="bg-primary/10 text-primary">
        {ROLE_LABEL.admin}
      </Badge>
    );
  }
  if (role === "teacher") {
    return <Badge variant="secondary">{ROLE_LABEL.teacher}</Badge>;
  }
  return <Badge variant="outline">{ROLE_LABEL.student}</Badge>;
}
