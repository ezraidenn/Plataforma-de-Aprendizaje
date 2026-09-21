import { requireTeacher } from "@/server/auth/guards";
import { AppShell } from "@/components/shell/app-shell";

export default async function TeacherLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireTeacher();
  return <AppShell user={user}>{children}</AppShell>;
}
