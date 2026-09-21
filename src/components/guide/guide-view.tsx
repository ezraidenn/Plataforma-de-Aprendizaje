"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Download,
  Lightbulb,
  GraduationCap,
  Presentation,
  ShieldCheck,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { KindChip, kindMeta } from "@/components/kind-meta";
import { SECTION_META } from "@/components/shell/sections";
import { cn } from "@/lib/utils";
import type { RoleGuide, GuideSection } from "@/content/guide/types";
import { MOBILE_SHOTS } from "@/content/guide/shots";
import { SectionNav } from "./section-nav";
import { GuideScene } from "./guide-scene";

const ROLE_ICON = { teacher: Presentation, student: GraduationCap, admin: ShieldCheck } as const;

/** id de la captura real del paso: `${rol}-${sección}-${n}` (ver scripts/guide-shots.cjs). */
export function shotId(role: string, sectionId: string, stepIndex: number): string {
  return `${role}-${sectionId}-${stepIndex + 1}`;
}

function Shot({ id, caption, mobile }: { id: string; caption: string; mobile?: boolean }) {
  return (
    <figure className={cn("mt-3", mobile && "max-w-[300px]")}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/guide/${id}.jpg`}
        alt={`Captura de pantalla: ${caption}`}
        loading="lazy"
        className="w-full rounded-xl border shadow-[0_10px_30px_-18px_rgb(15_23_42/0.45)]"
      />
      <figcaption className="mt-1.5 text-[11.5px] text-muted-foreground">
        Captura real de la plataforma · {caption}
      </figcaption>
    </figure>
  );
}

function SectionCard({
  role,
  section,
  index,
  shots,
}: {
  role: string;
  section: GuideSection;
  index: number;
  shots: Set<string>;
}) {
  const meta = SECTION_META[section.section];
  return (
    <section
      id={section.id}
      data-section={section.section}
      className={cn(
        "anim-rise overflow-hidden rounded-2xl border bg-card shadow-[0_1px_2px_rgb(15_23_42/0.05)]",
        index < 5 && `anim-d${index + 1}`
      )}
    >
      <header className="section-gradient flex items-start gap-4 px-5 py-4 text-white md:px-6">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/15 font-heading text-base font-bold">
          {index + 1}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <meta.Icon className="size-4 opacity-80" aria-hidden />
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] opacity-80">
              {meta.label}
            </span>
          </div>
          <h2 className="font-heading text-lg font-semibold leading-tight md:text-xl">
            {section.title}
          </h2>
          <p className="mt-1 text-[13.5px] leading-relaxed text-white/90">{section.intro}</p>
        </div>
      </header>

      <ol className="divide-y px-5 md:px-6">
        {section.steps.map((step, j) => {
          const id = shotId(role, section.id, j);
          return (
            <li key={step.title} className="flex gap-4 py-5">
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-section-soft text-[13px] font-bold text-section-strong">
                {j + 1}
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
                  {step.title}
                  {step.kind && (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-2.5 text-[12px] font-semibold",
                        kindMeta(step.kind).tintClass,
                        kindMeta(step.kind).textClass
                      )}
                    >
                      <KindChip kind={step.kind} size="sm" className="bg-white" />
                      {kindMeta(step.kind).label}
                    </span>
                  )}
                </h3>
                <p className="mt-1 text-[14.5px] leading-relaxed text-muted-foreground">
                  {step.text}
                </p>
                {step.ui && step.ui.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {step.ui.map((u) => (
                      <span
                        key={u}
                        className="rounded-md border bg-secondary/60 px-2 py-0.5 text-[12px] font-semibold text-foreground/80"
                      >
                        {u}
                      </span>
                    ))}
                  </div>
                )}
                {step.scene && <GuideScene id={step.scene} title={step.title} />}
                {shots.has(id) &&
                  (step.scene ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[13px] font-semibold text-section-strong">
                        Ver la pantalla real
                      </summary>
                      <Shot id={id} caption={step.title} mobile={MOBILE_SHOTS.has(id)} />
                    </details>
                  ) : (
                    <Shot id={id} caption={step.title} mobile={MOBILE_SHOTS.has(id)} />
                  ))}
                {step.tip && (
                  <p className="mt-2.5 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
                    <Lightbulb className="mt-0.5 size-4 shrink-0" aria-hidden />
                    {step.tip}
                  </p>
                )}
                {step.href && (
                  <Button
                    asChild
                    variant="link"
                    size="sm"
                    className="mt-1 h-auto px-0 text-section-strong"
                  >
                    <Link href={step.href}>
                      {step.hrefLabel ?? "Abrir"}
                      <ArrowRight className="size-3.5" aria-hidden />
                    </Link>
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function GuideView({ guides, shots }: { guides: RoleGuide[]; shots: string[] }) {
  const [active, setActive] = useState(guides[0]?.role ?? "student");
  const current = guides.find((g) => g.role === active) ?? guides[0];
  const shotSet = new Set(shots);

  return (
    <Tabs value={active} onValueChange={(v) => setActive(v as RoleGuide["role"])} className="gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {guides.length > 1 ? (
          <TabsList className="h-10 rounded-xl p-1">
            {guides.map((g) => {
              const Icon = ROLE_ICON[g.role];
              return (
                <TabsTrigger
                  key={g.role}
                  value={g.role}
                  className="h-8 gap-2 rounded-lg px-3 text-[13.5px] font-semibold"
                >
                  <Icon className="size-4" aria-hidden />
                  {g.label}
                </TabsTrigger>
              );
            })}
          </TabsList>
        ) : (
          <span />
        )}
        <Button asChild className="bg-section text-white hover:bg-section-strong">
          <a href={`/api/guide?role=${current.role}`} download>
            <Download className="size-4" aria-hidden />
            Descargar guía (HTML)
          </a>
        </Button>
      </div>

      {guides.map((g) => (
        <TabsContent key={g.role} value={g.role} className="space-y-5">
          <p className="text-[15px] text-muted-foreground">{g.tagline}</p>

          {/* Navegador siempre visible: chips sticky en móvil, columna sticky en escritorio */}
          <div className="lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:items-start lg:gap-6">
            <SectionNav sections={g.sections} prefix={`Guía · ${g.label}`} />
            <div className="mt-4 space-y-5 lg:mt-0">
              {g.sections.map((s, i) => (
                <SectionCard key={s.id} role={g.role} section={s} index={i} shots={shotSet} />
              ))}
            </div>
          </div>
        </TabsContent>
      ))}
    </Tabs>
  );
}
