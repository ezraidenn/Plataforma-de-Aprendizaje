import { requireAdmin } from "@/server/auth/guards";
import { AppShell } from "@/components/shell/app-shell";

/** Grupo de administración: solo rol admin; mismo shell con la sección extra del sidebar. */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAdmin();
  return <AppShell user={user}>{children}</AppShell>;
}
