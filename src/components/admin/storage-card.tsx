"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, FolderCog, HardDrive, Info, Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  testStorageRootAction,
  updateStorageRootAction,
} from "@/server/actions/admin-storage";
import { HelpTip } from "@/components/help/help-tip";

/**
 * Carpeta de almacenamiento (Admin → Configuración). Permite apuntar la
 * plataforma a un disco distinto o a un recurso del NAS. No mueve archivos:
 * eso lo hace `pnpm storage move`, que copia y verifica por hash.
 */
export function StorageCard({
  root,
  source,
  isUnc,
  fileCount,
  sizeLabel,
}: {
  root: string;
  source: string;
  isUnc: boolean;
  fileCount: number;
  sizeLabel: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(root);
  const [tested, setTested] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();

  const changed = value.trim() !== root;

  function test() {
    startBusy(async () => {
      const result = await testStorageRootAction(value);
      if ("error" in result) {
        setTested(null);
        toast.error(result.error);
        return;
      }
      setTested(value.trim());
      toast.success(result.warning ?? "La carpeta existe y admite escritura");
    });
  }

  function save() {
    startBusy(async () => {
      const result = await updateStorageRootAction(value);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Carpeta de almacenamiento actualizada");
      if (result.warning) toast.warning(result.warning);
      setTested(null);
      router.refresh();
    });
  }

  return (
    <Card className="anim-rise shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-heading text-base">
          <FolderCog className="size-4 text-section-strong" aria-hidden />
          Carpeta de almacenamiento
          <HelpTip topic="admin.storage" />
        </CardTitle>
        <CardDescription>
          Dónde se guardan los archivos de los cursos y las entregas. Puede ser un disco local o
          un recurso del NAS. La base de datos siempre se queda en el servidor.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-3 rounded-xl border bg-muted/40 p-3">
          <HardDrive className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 text-sm">
            <p className="break-all font-medium">{root}</p>
            <p className="text-xs text-muted-foreground">
              {fileCount} archivo(s) · {sizeLabel} · origen: {source}
              {isUnc ? " · recurso de red" : ""}
            </p>
          </div>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="storage-root">Ruta nueva</Label>
          <Input
            id="storage-root"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setTested(null);
            }}
            placeholder="\\\\NAS\\Capacitacion  o  D:\\Datos\\Capacitacion"
            spellCheck={false}
            className="font-mono text-[13px]"
          />
          <p className="text-xs text-muted-foreground">
            Escribe la ruta completa. Se comprueba que exista y admita escritura antes de guardarla.
          </p>
        </div>

        {changed && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            Cambiar la ruta <b>no mueve</b> los archivos que ya existen. Copia primero el contenido
            con <code className="font-mono">pnpm storage move --to «ruta»</code>, o los cursos
            quedarán sin sus archivos.
          </p>
        )}

        {tested === value.trim() && (
          <p className="flex items-center gap-2 text-[13px] text-success">
            <Check className="size-4" aria-hidden />
            Probada: la carpeta existe y admite escritura
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={test} disabled={busy || !value.trim()}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Probar
          </Button>
          <Button
            type="button"
            onClick={save}
            disabled={busy || !changed}
            className="bg-section text-white hover:bg-section-strong"
          >
            Guardar ruta
          </Button>
        </div>

        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Herramientas: <code className="font-mono">pnpm storage check</code> revisa la integridad
          y <code className="font-mono">pnpm storage plan</code> muestra si algún archivo quedó
          fuera de su carpeta.
        </p>
      </CardContent>
    </Card>
  );
}
