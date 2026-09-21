import { requireUser } from "@/server/auth/guards";
import { AppShell } from "@/components/shell/app-shell";

/** Rutas de cuenta compartidas por los 3 roles: /ajustes y /guia. */
export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return <AppShell user={user}>{children}</AppShell>;
}
