import type { SupabaseClient } from "@supabase/supabase-js";
import type { ModelKey, Profile } from "../db/types";

export async function loadProfile(sb: SupabaseClient): Promise<Profile> {
  const { data: auth } = await sb.auth.getUser();
  const { data, error } = await sb.from("profiles").select("*").eq("id", auth.user!.id).single();
  if (error || !data) throw new Error(error?.message ?? "读取资料失败");
  return data as Profile;
}

export async function updateSettings(sb: SupabaseClient, userId: string, s: { displayName?: string; defaultModel?: ModelKey }) {
  const patch: Record<string, string> = {};
  if (s.displayName !== undefined) patch.display_name = s.displayName.trim();
  if (s.defaultModel !== undefined) patch.default_model = s.defaultModel;
  const { error } = await sb.from("profiles").update(patch).eq("id", userId);
  if (error) throw new Error(error.message);
}
