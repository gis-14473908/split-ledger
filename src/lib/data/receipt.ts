import type { SupabaseClient } from "@supabase/supabase-js";
import type { ModelKey } from "../ai/models";
import type { ReceiptLine } from "../split/receipt";

export async function saveReceipt(
  sb: SupabaseClient,
  txId: string,
  r: { imagePath: string; totalPence: number; model: ModelKey; lines: ReceiptLine[]; names: Record<string, string> },
): Promise<void> {
  const { error: delError } = await sb.from("receipts").delete().eq("transaction_id", txId);
  if (delError) throw new Error(delError.message);

  const { data, error } = await sb
    .from("receipts")
    .insert({ transaction_id: txId, image_path: r.imagePath, total_pence: r.totalPence, model_used: r.model })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "保存小票失败");

  const { error: itemsError } = await sb.from("receipt_items").insert(
    r.lines.map((l, position) => ({
      receipt_id: data.id,
      name: r.names[l.id] ?? "",
      price_pence: l.pricePence,
      includes_me: l.includesMe,
      contact_ids: l.contactIds,
      position,
    })),
  );
  if (itemsError) throw new Error(itemsError.message);
}
