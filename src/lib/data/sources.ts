import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiSource } from "../db/types";

// Browser-facing: never read the api_key column back.
const SOURCE_COLUMNS = "id, owner_id, label, provider, model, key_last4, created_at";

export async function listSources(sb: SupabaseClient): Promise<AiSource[]> {
  const { data, error } = await sb.from("ai_sources").select(SOURCE_COLUMNS).order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as AiSource[];
}

export async function addSource(
  sb: SupabaseClient,
  userId: string,
  s: { label: string; provider: string; model: string; apiKey: string },
): Promise<void> {
  const key = s.apiKey.trim();
  const { error } = await sb.from("ai_sources").insert({
    owner_id: userId,
    label: s.label.trim(),
    provider: s.provider,
    model: s.model.trim(),
    api_key: key,
    key_last4: key.slice(-4),
  });
  if (error) throw new Error(error.message);
}

export async function deleteSource(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.from("ai_sources").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function readQuota(sb: SupabaseClient): Promise<{ usedMicro: number; grantedMicro: number }> {
  const { data: auth } = await sb.auth.getUser();
  const { data, error } = await sb
    .from("ai_quota")
    .select("used_micro, granted_micro")
    .eq("owner_id", auth.user!.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { usedMicro: 0, grantedMicro: 0 };
  return { usedMicro: Number(data.used_micro ?? 0), grantedMicro: Number(data.granted_micro ?? 0) };
}
