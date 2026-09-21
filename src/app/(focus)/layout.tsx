import { requireStudent } from "@/server/auth/guards";

/**
 * Grupo de rutas del Focus Mode (DISENO-UX §1.1): el shell global desaparece;
 * la navegación es el árbol del curso dentro de la propia página.
 */
export default async function FocusLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireStudent();
  return <>{children}</>;
}
