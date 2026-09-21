import { GraduationCap } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Logo de la empresa: imagen subida por el admin o el icono por defecto.
 * `size` en px (cuadrado). Server-safe (sin estado).
 */
export function BrandLogo({
  logoFileId,
  size = 32,
  className,
}: {
  logoFileId: string | null;
  size?: number;
  className?: string;
}) {
  if (logoFileId) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/api/files/${logoFileId}`}
        alt=""
        width={size}
        height={size}
        className={cn("rounded-lg object-contain", className)}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className={cn(
        "brand-gradient flex items-center justify-center rounded-lg text-primary-foreground",
        className
      )}
      style={{ width: size, height: size }}
    >
      <GraduationCap style={{ width: size * 0.62, height: size * 0.62 }} aria-hidden />
    </span>
  );
}
