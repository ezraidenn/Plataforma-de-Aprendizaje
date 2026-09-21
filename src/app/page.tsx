import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth/sessions";
import { homeFor } from "@/server/auth/guards";

export default async function RootPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  redirect(homeFor(user.role));
}
