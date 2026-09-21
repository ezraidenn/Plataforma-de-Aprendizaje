"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Copy,
  EllipsisVertical,
  KeyRound,
  Palette,
  Loader2,
  TriangleAlert,
  UserCog,
  UserRoundCheck,
  UserRoundX,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AdminWarningBanner } from "@/components/admin/admin-warning-banner";
import { ROLE_LABEL } from "@/components/admin/format";
import {
  adminChangeRoleAction,
  adminSetCanEditBrandingAction,
  adminResetPasswordAction,
  adminSetActiveAction,
} from "@/server/actions/admin-users";

type Role = "admin" | "teacher" | "student";

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "student", label: ROLE_LABEL.student },
  { value: "teacher", label: ROLE_LABEL.teacher },
  { value: "admin", label: ROLE_LABEL.admin },
];

export function UserActions({
  user,
  isSelf,
}: {
  user: {
    id: string;
    fullName: string;
    email: string;
    role: Role;
    active: boolean;
    canEditBranding?: boolean;
  };
  isSelf: boolean;
}) {
  const router = useRouter();
  const [resetOpen, setResetOpen] = useState(false);
  const [newPassword, setNewPassword] = useState<string | null>(null);
  const [roleOpen, setRoleOpen] = useState(false);
  const [nextRole, setNextRole] = useState<Role>(user.role);
  const [toggleOpen, setToggleOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  function resetPassword() {
    startTransition(async () => {
      const result = await adminResetPasswordAction(user.id);
      if ("error" in result) {
        toast.error(result.error);
        setResetOpen(false);
        return;
      }
      setNewPassword(result.password);
    });
  }

  function changeRole() {
    startTransition(async () => {
      const result = await adminChangeRoleAction(user.id, nextRole);
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success(`${user.fullName} ahora es ${ROLE_LABEL[nextRole].toLowerCase()}`);
        setRoleOpen(false);
        router.refresh();
      }
    });
  }

  function toggleActive() {
    startTransition(async () => {
      const result = await adminSetActiveAction(user.id, !user.active);
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success(
          user.active
            ? `La cuenta de ${user.fullName} quedó desactivada`
            : `La cuenta de ${user.fullName} quedó activa de nuevo`
        );
        router.refresh();
      }
      setToggleOpen(false);
    });
  }

  function toggleBranding() {
    const next = !user.canEditBranding;
    startTransition(async () => {
      const result = await adminSetCanEditBrandingAction(user.id, next);
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success(
          next
            ? `${user.fullName} ya puede editar la identidad de la empresa`
            : `${user.fullName} ya no puede editar la identidad`
        );
        router.refresh();
      }
    });
  }

  async function copyPassword() {
    if (!newPassword) return;
    try {
      await navigator.clipboard.writeText(newPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("No se pudo copiar. Copia el texto manualmente.");
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" aria-label={`Opciones de ${user.fullName}`}>
            <EllipsisVertical aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() => {
              setNewPassword(null);
              setCopied(false);
              setResetOpen(true);
            }}
          >
            <KeyRound aria-hidden />
            Restablecer contraseña
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              setNextRole(user.role);
              setRoleOpen(true);
            }}
          >
            <UserCog aria-hidden />
            Cambiar rol
          </DropdownMenuItem>
          {user.role === "teacher" && (
            <DropdownMenuItem onSelect={toggleBranding} disabled={pending}>
              <Palette aria-hidden />
              {user.canEditBranding ? "Quitar permiso de identidad" : "Puede editar identidad"}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          {user.active ? (
            <DropdownMenuItem variant="destructive" onSelect={() => setToggleOpen(true)}>
              <UserRoundX aria-hidden />
              Desactivar cuenta
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => setToggleOpen(true)}>
              <UserRoundCheck aria-hidden />
              Activar cuenta
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Restablecer contraseña: confirmación → nueva contraseña UNA sola vez */}
      <Dialog
        open={resetOpen}
        onOpenChange={(o) => {
          setResetOpen(o);
          if (!o) setNewPassword(null);
        }}
      >
        <DialogContent>
          {newPassword ? (
            <>
              <DialogHeader>
                <DialogTitle>Nueva contraseña de {user.fullName}</DialogTitle>
                <DialogDescription>Compártela ahora: no se volverá a mostrar.</DialogDescription>
              </DialogHeader>
              <div className="space-y-2 rounded-xl border bg-muted/40 p-4">
                <p className="text-sm font-semibold tracking-wide">{newPassword}</p>
                <p className="flex items-start gap-1.5 text-xs text-warning">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  La contraseña anterior dejó de funcionar y sus sesiones se cerraron.
                </p>
              </div>
              <DialogFooter>
                <Button variant="outline" className="h-11" onClick={copyPassword}>
                  {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                  {copied ? "Copiada" : "Copiar contraseña"}
                </Button>
                <Button
                  className="h-11 bg-cta text-cta-foreground hover:bg-cta/90"
                  onClick={() => setResetOpen(false)}
                >
                  Listo
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>¿Restablecer la contraseña de {user.fullName}?</DialogTitle>
                <DialogDescription>
                  Se generará una contraseña temporal nueva, la actual dejará de funcionar y sus
                  sesiones abiertas se cerrarán.
                </DialogDescription>
              </DialogHeader>
              {isSelf && (
                <p className="flex items-start gap-1.5 text-xs text-warning">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  Es tu propia cuenta: tu sesión se cerrará y tendrás que entrar con la nueva
                  contraseña.
                </p>
              )}
              <DialogFooter>
                <Button variant="outline" className="h-11" onClick={() => setResetOpen(false)}>
                  Cancelar
                </Button>
                <Button
                  className="h-11 bg-cta text-cta-foreground hover:bg-cta/90"
                  onClick={resetPassword}
                  disabled={pending}
                >
                  {pending && <Loader2 className="animate-spin" aria-hidden />}
                  {pending ? "Restableciendo…" : "Restablecer"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Cambiar rol */}
      <Dialog open={roleOpen} onOpenChange={setRoleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cambiar el rol de {user.fullName}</DialogTitle>
            <DialogDescription>
              Cambiar el rol afecta lo que este usuario puede ver y hacer.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor={`role-${user.id}`}>Nuevo rol</Label>
            <Select value={nextRole} onValueChange={(v) => setNextRole(v as Role)}>
              <SelectTrigger
                id={`role-${user.id}`}
                className="w-full"
                aria-label="Nuevo rol del usuario"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                    {option.value === user.role ? " (actual)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="h-11"
              onClick={() => setRoleOpen(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button
              className="h-11 bg-cta text-cta-foreground hover:bg-cta/90"
              onClick={changeRole}
              disabled={pending || nextRole === user.role}
            >
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              {pending ? "Guardando…" : "Cambiar rol"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Activar / desactivar cuenta */}
      <AlertDialog open={toggleOpen} onOpenChange={setToggleOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {user.active
                ? `¿Desactivar la cuenta de ${user.fullName}?`
                : `¿Activar la cuenta de ${user.fullName}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {user.active
                ? "No podrá iniciar sesión hasta que la reactives. Su información y progreso se conservan."
                : "Podrá volver a iniciar sesión con su contraseña actual."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {user.active && <AdminWarningBanner />}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className={
                user.active
                  ? "bg-destructive text-white hover:bg-destructive/90"
                  : "bg-cta text-cta-foreground hover:bg-cta/90"
              }
              onClick={toggleActive}
            >
              {user.active ? "Desactivar" : "Activar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
