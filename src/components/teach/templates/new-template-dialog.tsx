"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
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
import { createTemplateAction } from "@/server/actions/teacher-templates";
import { OnBehalfNote } from "@/components/teach/on-behalf-note";

export function NewTemplateDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createTemplateAction(name);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Plantilla creada. Acomoda los campos en el lienzo.");
      setOpen(false);
      router.push(`/teach/templates/${result.templateId}`);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setName("");
      }}
    >
      <DialogTrigger asChild>
        <Button className="h-11 bg-cta px-4 text-cta-foreground hover:bg-cta/90">
          <Plus aria-hidden />
          Nueva plantilla
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Nueva plantilla de certificado</DialogTitle>
            <DialogDescription>
              Nace con los campos básicos ya posicionados; después los acomodas en el editor.
            </DialogDescription>
          </DialogHeader>
          <OnBehalfNote subject="La plantilla" />
          <div className="grid gap-2">
            <Label htmlFor="new-template-name">Nombre</Label>
            <Input
              id="new-template-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. Diploma corporativo 2026"
              autoFocus
              required
              maxLength={120}
            />
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
              disabled={pending || !name.trim()}
            >
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              {pending ? "Creando…" : "Crear plantilla"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
