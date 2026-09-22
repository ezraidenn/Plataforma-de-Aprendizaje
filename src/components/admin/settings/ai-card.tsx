"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, KeyRound, Loader2, Sparkles, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  clearAiKeyAction,
  saveAiSettingsAction,
  testAiConnectionAction,
} from "@/server/actions/ai-exam";

/**
 * Inteligencia artificial (Admin → Configuración): la clave de OpenAI para
 * «Importar con IA» y el asistente del encabezado. Se guarda cifrada; aquí
 * solo se ve enmascarada. Sin clave, ninguna de las dos funciones aparece
 * para los maestros.
 */
export function AiCard({
  configured,
  unreadable,
  masked,
  model,
}: {
  configured: boolean;
  unreadable: boolean;
  masked: string | null;
  model: string;
}) {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [modelValue, setModelValue] = useState(model);
  const [tested, setTested] = useState(false);
  const [busy, startBusy] = useTransition();

  const dirty = key.trim() !== "" || modelValue.trim() !== model;

  function test() {
    startBusy(async () => {
      const result = await testAiConnectionAction({ key: key.trim() || undefined, model: modelValue });
      if ("error" in result) {
        setTested(false);
        toast.error(result.error);
        return;
      }
      setTested(true);
      toast.success("Conectado: la clave y el modelo funcionan");
    });
  }

  function save() {
    startBusy(async () => {
      const result = await saveAiSettingsAction({ key: key.trim() || undefined, model: modelValue });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Configuración de IA guardada");
      setKey("");
      router.refresh();
    });
  }

  function clear() {
    startBusy(async () => {
      await clearAiKeyAction();
      toast.success("Se quitó la clave: la importación con IA queda apagada");
      setTested(false);
      router.refresh();
    });
  }

  return (
    <Card className="anim-rise shadow-[0_1px_2px_rgb(15_23_42/0.05)]" data-ai-card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-heading text-base">
          <Sparkles className="size-4 text-section-strong" aria-hidden />
          Inteligencia artificial (OpenAI)
        </CardTitle>
        <CardDescription>
          Permite a los maestros importar preguntas de examen y listas de estudiantes desde cualquier
          archivo («Importar con IA») y usar el asistente del encabezado. El texto se envía a OpenAI
          solo cuando un maestro lo pide; necesita que el servidor tenga internet.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-3 rounded-xl border bg-muted/40 p-3 text-sm">
          <KeyRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          {configured ? (
            <p>
              <span className="font-medium text-success">Configurada</span> · clave {masked} · modelo{" "}
              <code className="font-mono text-[13px]">{model}</code>
            </p>
          ) : unreadable ? (
            <p className="text-amber-900">
              La clave guardada ya no se puede leer (cambió <code className="font-mono">APP_SECRET</code>).
              Vuelve a pegarla.
            </p>
          ) : (
            <p className="text-muted-foreground">Sin configurar: la importación con IA no aparece.</p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="ai-key">Clave de API</Label>
            <Input
              id="ai-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                setTested(false);
              }}
              placeholder={configured ? `${masked} (vacío = conservar)` : "sk-…"}
              className="font-mono text-[13px]"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ai-model">Modelo</Label>
            <Input
              id="ai-model"
              spellCheck={false}
              value={modelValue}
              onChange={(e) => {
                setModelValue(e.target.value);
                setTested(false);
              }}
              className="font-mono text-[13px]"
            />
            <p className="text-xs text-muted-foreground">
              Recomendado: gpt-5.6-terra. Más económico: gpt-5.6-luna.
            </p>
          </div>
        </div>

        {tested && (
          <p className="flex items-center gap-2 text-[13px] text-success">
            <Check className="size-4" aria-hidden />
            Conectado: la clave y el modelo funcionan
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={test} disabled={busy || (!configured && !key.trim())}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Probar conexión
          </Button>
          <Button
            type="button"
            onClick={save}
            disabled={busy || !dirty || (!configured && !key.trim())}
            className="bg-section text-white hover:bg-section-strong"
          >
            Guardar
          </Button>
          {(configured || unreadable) && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="ghost" className="text-destructive" disabled={busy}>
                  Quitar clave
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>¿Quitar la clave de OpenAI?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Los maestros dejarán de ver «Importar con IA». Lo que ya se importó (preguntas y
                    estudiantes) no se toca.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={clear}>Quitar clave</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>

        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          La clave se guarda cifrada en la base: una copia de la base no la revela sin el archivo
          <code className="font-mono"> .env </code>del servidor.
        </p>
      </CardContent>
    </Card>
  );
}
