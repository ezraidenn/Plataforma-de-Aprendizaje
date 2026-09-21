"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, Plus, RefreshCw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  adminCreateUserAction,
  newAdminTempPasswordAction,
} from "@/server/actions/admin-users";
import { ROLE_LABEL } from "@/components/admin/format";

type Role = "admin" | "teacher" | "student";

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "student", label: ROLE_LABEL.student },
  { value: "teacher", label: ROLE_LABEL.teacher },
  { value: "admin", label: ROLE_LABEL.admin },
];

export function NewUserDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("student");
  const [password, setPassword] = useState("");
  const [created, setCreated] = useState<{ email: string; password: string; role: Role } | null>(
    null
  );
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const [regenerating, startRegenerate] = useTransition();

  function reset() {
    setFullName("");
    setEmail("");
    setRole("student");
    setPassword("");
    setCreated(null);
    setCopied(false);
  }

  function loadPassword() {
    startRegenerate(async () => {
      const { password } = await newAdminTempPasswordAction();
      setPassword(password);
    });
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("No se pudo copiar. Copia el texto manualmente.");
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await adminCreateUserAction({ fullName, email, password, role });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setCreated({ email: email.trim().toLowerCase(), password, role });
      toast.success("Usuario creado");
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next && !password) loadPassword();
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button className="h-11 bg-cta px-4 text-cta-foreground hover:bg-cta/90">
          <Plus aria-hidden />
          Nuevo usuario
        </Button>
      </DialogTrigger>
      <DialogContent>
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Credenciales del usuario</DialogTitle>
              <DialogDescription>
                Guárdalas ahora: la contraseña no se volverá a mostrar.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 rounded-xl border bg-muted/40 p-4">
              <div>
                <p className="text-xs text-muted-foreground">Correo</p>
                <p className="text-sm font-medium">{created.email}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Contraseña temporal</p>
                <p className="text-sm font-semibold tracking-wide">{created.password}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Rol</p>
                <p className="text-sm font-medium">{ROLE_LABEL[created.role]}</p>
              </div>
              <p className="flex items-start gap-1.5 text-xs text-warning">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                Si se pierde, tendrás que restablecerla desde el menú del usuario.
              </p>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                className="h-11"
                onClick={() =>
                  copyText(`Correo: ${created.email}\nContraseña: ${created.password}`)
                }
              >
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                {copied ? "Copiadas" : "Copiar credenciales"}
              </Button>
              <Button
                className="h-11 bg-cta text-cta-foreground hover:bg-cta/90"
                onClick={() => setOpen(false)}
              >
                Listo
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={handleSubmit} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Nuevo usuario</DialogTitle>
              <DialogDescription>
                La cuenta se crea con una contraseña temporal que podrás copiar al final.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="admin-user-name">Nombre completo</Label>
              <Input
                id="admin-user-name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Ej. Laura Pérez Domínguez"
                autoFocus
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="admin-user-email">Correo electrónico</Label>
              <Input
                id="admin-user-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="laura@empresa.com"
                autoComplete="off"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="admin-user-role">Rol</Label>
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger id="admin-user-role" className="w-full" aria-label="Rol del usuario">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                El rol define lo que esta persona puede ver y hacer en la plataforma.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="admin-user-password">Contraseña inicial (autogenerada)</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="admin-user-password"
                  value={password}
                  readOnly
                  className="font-semibold tracking-wide"
                />
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  onClick={loadPassword}
                  disabled={regenerating}
                  aria-label="Generar otra contraseña"
                >
                  <RefreshCw className={regenerating ? "animate-spin" : undefined} aria-hidden />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  onClick={() => copyText(password)}
                  aria-label="Copiar contraseña"
                >
                  {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                </Button>
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="h-11"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                className="h-11 bg-cta text-cta-foreground hover:bg-cta/90"
                disabled={pending || !fullName.trim() || !email.trim() || !password}
              >
                {pending && <Loader2 className="animate-spin" aria-hidden />}
                {pending ? "Creando…" : "Crear usuario"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
