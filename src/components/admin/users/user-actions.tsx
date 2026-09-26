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
  Trash2,
  TriangleAlert,
  UserCog,
  UserPen,
  UserRoundCheck,
  UserRoundX,
} from "lucide-react";
import { toast } from "sonner";
import { copyToClipboard } from "@/lib/clipboard";
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
import { Input } from "@/components/ui/input";
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
  adminDeleteUserAction,
  adminDeleteUserPreviewAction,
  adminResetPasswordAction,
  adminSetActiveAction,
  adminUpdateUserAction,
} from "@/server/actions/admin-users";
import type { DeleteUserImpact } from "@/server/services/admin";

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
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState(user.fullName);
  const [editEmail, setEditEmail] = useState(user.email);
  const [resetOpen, setResetOpen] = useState(false);
  // Vacía = se genera una temporal
  const [chosenPassword, setChosenPassword] = useState("");
  const [newPassword, setNewPassword] = useState<string | null>(null);
  const [roleOpen, setRoleOpen] = useState(false);
  const [nextRole, setNextRole] = useState<Role>(user.role);
  const [toggleOpen, setToggleOpen] = useState(false);
  // Borrado definitivo: 1 = qué se pierde, 2 = escribir el correo
  const [deleteStep, setDeleteStep] = useState<0 | 1 | 2>(0);
  const [deleteImpact, setDeleteImpact] = useState<DeleteUserImpact | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const editDirty =
    editName.trim().replace(/\s+/g, " ") !== user.fullName ||
    editEmail.trim().toLowerCase() !== user.email;

  function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await adminUpdateUserAction(user.id, {
        fullName: editName,
        email: editEmail,
      });
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success("Datos actualizados");
        setEditOpen(false);
        router.refresh();
      }
    });
  }

  function resetPassword() {
    startTransition(async () => {
      const result = await adminResetPasswordAction(user.id, chosenPassword || undefined);
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

  function openDelete() {
    setDeleteImpact(null);
    setDeleteConfirm("");
    setDeleteStep(1);
    startTransition(async () => {
      const result = await adminDeleteUserPreviewAction(user.id);
      if ("error" in result) {
        toast.error(result.error);
        setDeleteStep(0);
      } else {
        setDeleteImpact(result.impact);
      }
    });
  }

  function deleteUser() {
    startTransition(async () => {
      const result = await adminDeleteUserAction(user.id, deleteConfirm);
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success(`Se eliminó la cuenta de ${user.fullName}`);
        setDeleteStep(0);
        router.refresh();
      }
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
    if (await copyToClipboard(newPassword)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
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
              setEditName(user.fullName);
              setEditEmail(user.email);
              setEditOpen(true);
            }}
          >
            <UserPen aria-hidden />
            Editar datos
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              setNewPassword(null);
              setChosenPassword("");
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
          {!isSelf && (
            <DropdownMenuItem variant="destructive" onSelect={openDelete}>
              <Trash2 aria-hidden />
              Eliminar definitivamente
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Editar nombre y correo */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <form onSubmit={saveEdit} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Editar datos de {user.fullName}</DialogTitle>
              <DialogDescription>
                El correo es con el que inicia sesión: si lo cambias, avísale.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor={`edit-name-${user.id}`}>Nombre completo</Label>
              <Input
                id={`edit-name-${user.id}`}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={80}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`edit-email-${user.id}`}>Correo electrónico</Label>
              <Input
                id={`edit-email-${user.id}`}
                type="email"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                autoComplete="off"
                required
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="h-11"
                onClick={() => setEditOpen(false)}
                disabled={pending}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                className="h-11 bg-cta text-cta-foreground hover:bg-cta/90"
                disabled={pending || !editDirty || !editName.trim() || !editEmail.trim()}
              >
                {pending && <Loader2 className="animate-spin" aria-hidden />}
                {pending ? "Guardando…" : "Guardar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

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
                  La contraseña actual dejará de funcionar y sus sesiones abiertas se cerrarán.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-2">
                <Label htmlFor={`reset-password-${user.id}`}>Contraseña nueva (opcional)</Label>
                <Input
                  id={`reset-password-${user.id}`}
                  value={chosenPassword}
                  onChange={(e) => setChosenPassword(e.target.value)}
                  placeholder="Déjala vacía para generar una temporal"
                  autoComplete="new-password"
                  className="font-semibold tracking-wide"
                />
                {chosenPassword && chosenPassword.length < 8 ? (
                  <p className="text-xs text-destructive">Debe tener al menos 8 caracteres.</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Escribe una si ya la acordaste con la persona.
                  </p>
                )}
              </div>
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
                  disabled={pending || (chosenPassword.length > 0 && chosenPassword.length < 8)}
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
              variant={user.active ? "destructive" : "default"}
              className={user.active ? undefined : "bg-cta text-cta-foreground hover:bg-cta/90"}
              onClick={toggleActive}
            >
              {user.active ? "Desactivar" : "Activar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Eliminar definitivamente: 1) qué se pierde → 2) escribir el correo */}
      <Dialog
        open={deleteStep > 0}
        onOpenChange={(o) => {
          if (!o && !pending) setDeleteStep(0);
        }}
      >
        <DialogContent>
          {deleteStep === 1 ? (
            <>
              <DialogHeader>
                <DialogTitle>¿Eliminar definitivamente a {user.fullName}?</DialogTitle>
                <DialogDescription>
                  No se puede deshacer. Si solo quieres impedir que entre, desactiva la cuenta.
                </DialogDescription>
              </DialogHeader>
              {!deleteImpact ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Revisando la cuenta…
                </p>
              ) : deleteImpact.blockers.length > 0 ? (
                <div className="space-y-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
                  <p className="text-sm font-semibold">Esta cuenta no se puede eliminar:</p>
                  <ul className="list-disc space-y-1 pl-5 text-sm">
                    {deleteImpact.blockers.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="space-y-2 rounded-xl border bg-muted/40 p-4 text-sm">
                  <p className="font-semibold">Se borrará para siempre:</p>
                  <ul className="list-disc space-y-1 pl-5">
                    <li>La cuenta ({user.email}) y sus sesiones</li>
                    <li>{deleteImpact.enrollments} inscripción(es) a cursos, con su progreso</li>
                    <li>{deleteImpact.attempts} intento(s) de examen</li>
                    <li>{deleteImpact.submissions} entrega(s) de tareas y sus archivos</li>
                  </ul>
                  {deleteImpact.cohorts > 0 && (
                    <p className="text-muted-foreground">
                      Sus {deleteImpact.cohorts} grupo(s) no se borran: pasan a tu nombre.
                    </p>
                  )}
                  <p className="text-muted-foreground">
                    Lo que registró en la auditoría se conserva, sin su nombre.
                  </p>
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" className="h-11" onClick={() => setDeleteStep(0)}>
                  {deleteImpact && deleteImpact.blockers.length > 0 ? "Cerrar" : "Cancelar"}
                </Button>
                {deleteImpact && deleteImpact.blockers.length === 0 && (
                  <Button
                    variant="outline"
                    className="h-11 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setDeleteStep(2)}
                  >
                    Continuar
                  </Button>
                )}
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Confirma la eliminación</DialogTitle>
                <DialogDescription>
                  Escribe el correo de la cuenta para eliminarla definitivamente.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-2">
                <Label htmlFor={`delete-confirm-${user.id}`}>
                  Escribe <span className="font-semibold">{user.email}</span>
                </Label>
                <Input
                  id={`delete-confirm-${user.id}`}
                  value={deleteConfirm}
                  onChange={(e) => setDeleteConfirm(e.target.value)}
                  autoComplete="off"
                  autoFocus
                />
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  className="h-11"
                  onClick={() => setDeleteStep(1)}
                  disabled={pending}
                >
                  Atrás
                </Button>
                <Button
                  className="h-11 bg-destructive text-white hover:bg-destructive/90"
                  onClick={deleteUser}
                  disabled={pending || deleteConfirm.trim().toLowerCase() !== user.email}
                >
                  {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
                  {pending ? "Eliminando…" : "Eliminar definitivamente"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
