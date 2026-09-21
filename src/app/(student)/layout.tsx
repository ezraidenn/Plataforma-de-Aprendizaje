import { requireStudent } from "@/server/auth/guards";
import { AppShell } from "@/components/shell/app-shell";

export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireStudent();
  return <AppShell user={user}>{children}</AppShell>;
}
