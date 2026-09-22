"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BookPlus, Check, Copy, Loader2, Plus, RefreshCw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { copyToClipboard } from "@/lib/clipboard";
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
  createStudentAction,
  newTempPasswordAction,
} from "@/server/actions/teacher-students";
import { OnBehalfNote } from "@/components/teach/on-behalf-note";
import { OpenFromUrl } from "@/components/open-from-url";
import { clearUrlParam, useOpenDialogRequest } from "@/lib/open-dialog";

/** `urlTrigger`: solo una instancia por página debe abrirse sola */
export function NewStudentDialog({ urlTrigger = false }: { urlTrigger?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [created, setCreated] = useState<{ email: string; password: string; studentId: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const [regenerating, startRegenerate] = useTransition();

  function reset() {
    setFullName("");
    setEmail("");
    setPassword("");
    setCreated(null);
    setCopied(false);
  }

  function loadPassword() {
    startRegenerate(async () => {
      const { password } = await newTempPasswordAction();
      setPassword(password);
    });
  }

  async function copyText(text: string) {
    if (await copyToClipboard(text)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error("No se pudo copiar. Copia el texto manualmente.");
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createStudentAction({ fullName, email, password });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setCreated({ email: email.trim().toLowerCase(), password, studentId: result.studentId });
      toast.success("Estudiante creado");
      router.refresh();
    });
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next && !password) loadPassword();
    if (!next) {
      reset();
      clearUrlParam("nuevo");
    }
  }

  // `OpenFromUrl` y el bus guardan el manejador en una ref: no hace falta
  // memorizarlo y siempre llaman a la última versión
  function openSelf() {
    handleOpenChange(true);
  }
  // Misma regla que ?nuevo=1: solo la instancia marcada se abre sola
  useOpenDialogRequest("new-student", () => {
    if (urlTrigger) openSelf();
  });

  return (
    <>
      {urlTrigger && <OpenFromUrl param="nuevo" onOpen={openSelf} />}
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>
          <Button className="h-11 bg-cta px-4 text-cta-foreground hover:bg-cta/90">
            <Plus aria-hidden />
            Nuevo
          </Button>
        </DialogTrigger>
        <DialogContent>
          {created ? (
            <>
              <DialogHeader>
                <DialogTitle>Credenciales del estudiante</DialogTitle>
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
                <p className="flex items-start gap-1.5 text-xs text-warning">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  Si se pierde, tendrás que restablecerla desde el menú del estudiante.
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
                  onClick={() => {
                    setOpen(false);
                    router.push(`/teach/students/${created.studentId}?matricular=1`);
                  }}
                >
                  <BookPlus aria-hidden />
                  Matricular en cursos
                </Button>
                <Button variant="ghost" className="h-11" onClick={() => handleOpenChange(false)}>
                  Listo
                </Button>
              </DialogFooter>
            </>
          ) : (
            <form onSubmit={handleSubmit} className="grid gap-4">
              <DialogHeader>
                <DialogTitle>Nuevo estudiante</DialogTitle>
                <DialogDescription>
                  La cuenta se crea con una contraseña temporal que podrás copiar al final.
                </DialogDescription>
              </DialogHeader>
              <OnBehalfNote subject="El estudiante" />
              <div className="grid gap-2">
                <Label htmlFor="student-name">Nombre completo</Label>
                <Input
                  id="student-name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Ej. Laura Pérez Domínguez"
                  autoFocus
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="student-email">Correo electrónico</Label>
                <Input
                  id="student-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="laura@empresa.com"
                  autoComplete="off"
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="student-password">Contraseña inicial (autogenerada)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="student-password"
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
                  onClick={() => handleOpenChange(false)}
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
                  {pending ? "Creando…" : "Crear estudiante"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
