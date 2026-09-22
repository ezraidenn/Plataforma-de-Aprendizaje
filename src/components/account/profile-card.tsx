"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { updateOwnEmailAction, updateOwnNameAction } from "@/server/actions/account";
import { RoleBadge } from "@/components/admin/role-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Role = "admin" | "teacher" | "student";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase() || "?";
}

export function ProfileCard({
  profile,
  className,
}: {
  profile: { fullName: string; email: string; role: Role };
  className?: string;
}) {
  const router = useRouter();
  // Nombre y correo: maestro/admin los editan; al estudiante se los administra su instructor
  const canEditName = profile.role !== "student";
  const [name, setName] = useState(profile.fullName);
  const [email, setEmail] = useState(profile.email);
  const [currentPassword, setCurrentPassword] = useState("");
  const [saving, startSaving] = useTransition();
  const trimmed = name.trim().replace(/\s+/g, " ");
  const normalizedEmail = email.trim().toLowerCase();
  const nameDirty = trimmed !== profile.fullName;
  const emailDirty = normalizedEmail !== profile.email;
  const dirty = nameDirty || emailDirty;

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    startSaving(async () => {
      if (nameDirty) {
        const result = await updateOwnNameAction(trimmed);
        if ("error" in result) {
          toast.error(result.error);
          return;
        }
        toast.success("Nombre actualizado");
      }
      if (emailDirty) {
        const result = await updateOwnEmailAction({ email: normalizedEmail, currentPassword });
        if ("error" in result) {
          toast.error(result.error);
          if (nameDirty) router.refresh();
          return;
        }
        setEmail(normalizedEmail);
        setCurrentPassword("");
        toast.success("Correo actualizado: úsalo la próxima vez que inicies sesión");
      }
      router.refresh();
    });
  }

  const emailField = (
    <div className="space-y-2">
      <Label htmlFor="profile-email">Correo</Label>
      <Input
        id="profile-email"
        value={profile.email}
        readOnly
        aria-readonly
        className="h-11 bg-muted/40 text-muted-foreground"
      />
    </div>
  );

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-heading text-base">
          <span className="flex size-7 items-center justify-center rounded-md bg-section-soft text-section-strong">
            <UserRound className="size-4" aria-hidden />
          </span>
          Mi perfil
        </CardTitle>
        <CardDescription>Cómo te ves dentro de la plataforma.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center gap-4">
          <span
            aria-hidden
            className="section-gradient flex size-16 shrink-0 items-center justify-center rounded-2xl font-heading text-xl font-bold text-section-fg shadow-sm"
          >
            {initials(profile.fullName)}
          </span>
          <div className="min-w-0">
            <p className="truncate font-heading text-lg font-semibold">{profile.fullName}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <RoleBadge role={profile.role} />
              <span className="truncate text-sm text-muted-foreground">{profile.email}</span>
            </div>
          </div>
        </div>

        {canEditName ? (
          <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="profile-name">Nombre completo</Label>
              <Input
                id="profile-name"
                value={name}
                maxLength={80}
                minLength={3}
                autoComplete="name"
                onChange={(e) => setName(e.target.value)}
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-email">Correo</Label>
              <Input
                id="profile-email"
                type="email"
                value={email}
                maxLength={120}
                autoComplete="email"
                onChange={(e) => setEmail(e.target.value)}
                className="h-11"
              />
            </div>
            {emailDirty && (
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="profile-email-password">Tu contraseña actual</Label>
                <Input
                  id="profile-email-password"
                  type="password"
                  value={currentPassword}
                  autoComplete="current-password"
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="h-11 sm:max-w-sm"
                />
                <p className="text-xs text-muted-foreground">
                  El correo es con el que inicias sesión: confírmalo con tu contraseña.
                </p>
              </div>
            )}
            <div className="sm:col-span-2">
              <Button
                type="submit"
                className="h-11 bg-section text-white hover:bg-section-strong"
                disabled={
                  saving ||
                  !dirty ||
                  trimmed.length < 3 ||
                  !normalizedEmail ||
                  (emailDirty && !currentPassword)
                }
              >
                {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
                Guardar cambios
              </Button>
            </div>
          </form>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="profile-name">Nombre completo</Label>
              <Input
                id="profile-name"
                value={profile.fullName}
                readOnly
                aria-readonly
                className="h-11 bg-muted/40 text-muted-foreground"
              />
            </div>
            {emailField}
            <p className="text-xs text-muted-foreground sm:col-span-2">
              Tu nombre y correo los administra tu instructor.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
