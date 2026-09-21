"use client";

import { Suspense, useState, type ComponentType } from "react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Caption } from "./caption";
import { CATALOG_FIELDS, CATALOG_GROUPS, type CatalogField } from "./catalog-config";
import { SCENES } from "./registry";
import { SceneFrame, SceneSkeleton } from "./scene-frame";
import { HELP_TOPICS, type HelpTopicId } from "./topics";

type Values = Record<string, unknown>;

const SELECT = "h-9 rounded-md border bg-background px-2 text-sm";

/** Un control del catálogo según su configuración. */
function FieldControl({ field, value, onChange }: { field: CatalogField; value: Values; onChange: (v: Values) => void }) {
  if (field.when && !field.when(value)) return null;
  const set = (next: unknown) => onChange({ ...value, [field.key]: next });
  const current = value[field.key];
  switch (field.type) {
    case "switch":
      return (
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={current === true} onCheckedChange={set} />
          {current === true ? field.on : field.off}
        </label>
      );
    case "presence": {
      const present = current !== null && current !== undefined;
      return (
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={present} onCheckedChange={(on) => set(on ? field.present : null)} />
          {present ? field.on : field.off}
        </label>
      );
    }
    case "text":
      return (
        <Input
          aria-label={field.label}
          placeholder={field.placeholder}
          className="h-9 w-40"
          value={typeof current === "string" ? current : ""}
          onChange={(e) => set(e.target.value)}
        />
      );
    case "select":
      return (
        <select aria-label={field.label} className={SELECT} value={String(current)} onChange={(e) => set(e.target.value)}>
          {field.options.map(([v, text]) => (
            <option key={v} value={v}>
              {text}
            </option>
          ))}
        </select>
      );
    case "number": {
      const shown = typeof current === "number" ? String(current) : field.nullable ? "" : String(field.fallback ?? field.min);
      return (
        <label className="flex items-center gap-2 text-sm">
          <Input
            aria-label={field.label}
            type="number"
            min={field.min}
            max={field.max}
            placeholder={field.nullable}
            className={cn("h-9", field.nullable ? "w-28" : "w-24")}
            value={shown}
            onChange={(e) => {
              if (e.target.value === "" && field.nullable) return set(null);
              const n = Number(e.target.value);
              set(Math.max(field.min, Math.min(field.max, Number.isFinite(n) ? Math.round(n) : field.min)));
            }}
          />
          {field.suffix}
        </label>
      );
    }
  }
}

function CatalogCard({ topic }: { topic: HelpTopicId }) {
  const def = HELP_TOPICS[topic];
  const [value, setValue] = useState<Values>(def.example as Values);
  const Scene = SCENES[topic] as unknown as ComponentType<{ value: Values }>;
  const caption = (def.caption as (v: Values) => string)(value);
  const fields = CATALOG_FIELDS[topic] ?? [];
  return (
    <article className="rounded-2xl border bg-card p-4 shadow-[0_1px_2px_rgb(15_23_42/0.05)]" data-topic={topic}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{def.where}</p>
      <h3 className="font-heading text-base font-semibold">{def.label}</h3>
      {fields.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {fields.map((field) => (
            <FieldControl key={field.key} field={field} value={value} onChange={setValue} />
          ))}
        </div>
      )}
      <p className="mt-3 text-[10px] font-extrabold uppercase tracking-[0.12em] text-cta">{def.kicker}</p>
      <SceneFrame topic={topic} className="mt-2">
        <Suspense fallback={<SceneSkeleton />}>
          <Scene key={JSON.stringify(value)} value={value} />
        </Suspense>
      </SceneFrame>
      <Caption text={caption} className="mt-2.5 text-[13px] leading-snug text-slate-700" />
    </article>
  );
}

/** Todas las escenas de ayuda por grupo, con controles para probar valores. */
export function HelpCatalog() {
  return (
    <div className="space-y-8">
      {CATALOG_GROUPS.map((group, i) => (
        <section key={group.title} aria-labelledby={`ayuda-grupo-${i}`} className="space-y-3">
          <h2 id={`ayuda-grupo-${i}`} className="font-heading text-lg font-semibold">
            {group.title}
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            {group.topics.map((topic) => (
              <CatalogCard key={topic} topic={topic} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
