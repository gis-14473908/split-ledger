import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_SOURCE_KEY, PRICES, parseSourceKey, providerById } from "./catalog";
import { AiError } from "./errors";
import { MODEL_IDS, MODEL_LABEL, type ModelKey } from "./models";
import type { ResolvedSource } from "./run";

type ParsedKey = NonNullable<ReturnType<typeof parseSourceKey>>;

/** Parse a stored/requested source key, falling back to the built-in default. */
export function parseOrDefault(key: string | undefined): ParsedKey {
  return parseSourceKey(key ?? "") ?? (parseSourceKey(DEFAULT_SOURCE_KEY) as ParsedKey);
}

export async function resolveSource(
  sb: SupabaseClient,
  userId: string,
  key: string | undefined,
): Promise<ResolvedSource> {
  const parsed = parseOrDefault(key);
  if (parsed.kind === "builtin") {
    const m = parsed.model;
    return {
      kind: "builtin",
      apiFormat: "anthropic",
      model: MODEL_IDS[m],
      apiKey: process.env.ANTHROPIC_API_KEY ?? "",
      baseURL: undefined,
      label: MODEL_LABEL[m],
      allowServerFallback: m !== "haiku",
    };
  }
  const { data: row, error } = await sb
    .from("ai_sources")
    .select("*")
    .eq("id", parsed.id)
    .eq("owner_id", userId)
    .single();
  if (error || !row) throw new AiError("bad_request");
  const prov = providerById(row.provider);
  if (!prov) throw new AiError("bad_request");
  return {
    kind: "custom",
    apiFormat: prov.apiFormat,
    model: row.model,
    apiKey: row.api_key,
    baseURL: prov.baseURL ?? undefined,
    label: row.label,
    allowServerFallback: false,
  };
}

export function costMicro(model: ModelKey, usage: { inputTokens: number; outputTokens: number }): number {
  return Math.round(
    usage.inputTokens * PRICES[model].inMicroPerTok + usage.outputTokens * PRICES[model].outMicroPerTok,
  );
}
