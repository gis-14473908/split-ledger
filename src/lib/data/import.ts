import type { SupabaseClient } from "@supabase/supabase-js";
import type { ModelKey } from "../ai/models";
import type { ImportedTransaction } from "../ai/schemas";
import { dedupeKey } from "../dedupe";

export async function uploadImage(
  sb: SupabaseClient,
  userId: string,
  blob: Blob,
  kind: "statement" | "receipt",
): Promise<string> {
  const path = `${userId}/${kind}/${crypto.randomUUID()}.jpg`;
  const { error } = await sb.storage.from("uploads").upload(path, blob, { contentType: "image/jpeg" });
  if (error) throw new Error(error.message);
  return path;
}

export async function existingDedupeKeys(sb: SupabaseClient, keys: string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const { data, error } = await sb.from("transactions").select("dedupe_key").in("dedupe_key", keys);
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((r: { dedupe_key: string }) => r.dedupe_key));
}

export async function saveImport(
  sb: SupabaseClient,
  rows: ImportedTransaction[],
  meta: { kind: "screenshot"; filePaths: string[]; model: ModelKey },
): Promise<number> {
  const { data: imp, error: impError } = await sb
    .from("imports")
    .insert({ kind: meta.kind, file_paths: meta.filePaths, model_used: meta.model })
    .select("id")
    .single();
  if (impError || !imp) throw new Error(impError?.message ?? "import failed");

  const { error } = await sb.from("transactions").insert(
    rows.map((r) => ({
      import_id: imp.id,
      occurred_on: r.occurredOn,
      occurred_at_time: r.occurredTime,
      merchant_raw: r.merchantRaw,
      merchant: r.merchant,
      location: r.location,
      amount_pence: r.amountPence,
      original_amount: r.originalAmount,
      original_currency: r.originalCurrency,
      category: r.category ?? "other",
      bank: r.bank,
      source: "screenshot",
      status: r.status,
      ai_hint: r.hint,
      dedupe_key: dedupeKey(r),
    })),
  );
  if (error) throw new Error(error.message);
  return rows.length;
}
