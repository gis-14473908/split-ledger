"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { builtinSourceKey, DEFAULT_SOURCE_KEY } from "@/lib/ai/catalog";
import { MODEL_KEYS, MODEL_LABEL } from "@/lib/ai/models";
import { listSources } from "@/lib/data/sources";

export type SourceOption = { value: string; label: string };

const BUILTIN_OPTIONS: SourceOption[] = MODEL_KEYS.map((m) => ({ value: builtinSourceKey(m), label: MODEL_LABEL[m] }));

/** Loads picker options (built-in tiers + custom sources) and the profile's default source. */
export function useSourcePicker(sb: SupabaseClient) {
  const [options, setOptions] = useState<SourceOption[]>(BUILTIN_OPTIONS);
  const [sourceKey, setSourceKey] = useState<string>(DEFAULT_SOURCE_KEY);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [custom, auth] = await Promise.all([listSources(sb), sb.auth.getUser()]);
        if (!alive) return;
        setOptions([...BUILTIN_OPTIONS, ...custom.map((s) => ({ value: `custom:${s.id}`, label: s.label }))]);
        const uid = auth.data.user?.id;
        if (!uid) return;
        const { data: profile } = await sb.from("profiles").select("default_source").eq("id", uid).single();
        if (alive && profile?.default_source) setSourceKey(profile.default_source);
      } catch {
        // keep built-in options and the default source
      }
    })();
    return () => {
      alive = false;
    };
  }, [sb]);

  return { options, sourceKey, setSourceKey };
}

export function SourceSelect({
  options,
  value,
  onChange,
  disabled,
}: {
  options: SourceOption[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <select className="field py-1 text-sm" aria-label="识别用的 AI 源" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}
