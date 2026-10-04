import type { Metadata } from "next";
import { Settings } from "lucide-react";
import { requireUser } from "@/server/auth/guards";
import { MAIL_PREFS, canEditBranding, getMailPrefs, getOwnProfile } from "@/server/services/profile";
import { getBranding } from "@/server/services/branding";
import { PageHeader } from "@/components/shell/page-header";
import { ProfileCard } from "@/components/account/profile-card";
import { PasswordCard } from "@/components/account/password-card";
import { MailPrefsCard } from "@/components/account/mail-prefs-card";
import { IdentityCard } from "@/components/account/identity-card";
import { GuideLinkCard, SessionCard } from "@/components/account/session-cards";

export const metadata: Metadata = { title: "Ajustes" };

const CARD = "anim-rise shadow-[0_1px_2px_rgb(15_23_42/0.05)]";

export default async function AjustesPage() {
  const user = await requireUser();
  const profile = getOwnProfile(user.id) ?? {
    fullName: user.fullName,
    email: user.email,
    role: user.role,
  };
  const showIdentity = canEditBranding(user);
  const branding = showIdentity ? getBranding() : null;
  const mailPrefs = getMailPrefs(user.id);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Cuenta"
        title="Ajustes"
        description="Tu perfil, tu contraseña y, si tienes permiso, la identidad de la empresa."
        icon={Settings}
      />

      <ProfileCard
        profile={{ fullName: profile.fullName, email: profile.email, role: profile.role }}
        className={`${CARD} anim-d1`}
      />

      <PasswordCard className={`${CARD} anim-d2`} />

      {mailPrefs && <MailPrefsCard prefs={mailPrefs} available={MAIL_PREFS[user.role]} className={`${CARD} anim-d2`} />}

      {branding && (
        <IdentityCard
          platformName={branding.platformName}
          logoFileId={branding.logoFileId}
          cover={branding.cover}
          className={`${CARD} anim-d3`}
        />
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <GuideLinkCard className={`${CARD} ${branding ? "anim-d4" : "anim-d3"}`} />
        <SessionCard className={`${CARD} ${branding ? "anim-d5" : "anim-d4"}`} />
      </div>
    </div>
  );
}
