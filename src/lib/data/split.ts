import type { SupabaseClient } from "@supabase/supabase-js";
import type { AaMode } from "../split/aa";
import type { Share } from "../split/equal";

export type AaSave = { mode: AaMode; paid: Share[]; amountPence: number };

/** Replace a bill's shares in one database call (plain, or the AA variant). */
export async function rpcSetSplit(sb: SupabaseClient, txId: string, shares: Share[], aa?: AaSave | null) {
  const p_shares = shares.map((s) => ({ contact_id: s.contactId, share_pence: s.sharePence }));
  const { error } = aa
    ? await sb.rpc("set_transaction_split_aa", {
        p_tx: txId,
        p_shares,
        p_mode: aa.mode,
        p_paid: aa.paid.map((s) => ({ contact_id: s.contactId, share_pence: s.sharePence })),
        p_amount: aa.mode === "each" ? aa.amountPence : null,
      })
    : await sb.rpc("set_transaction_split", { p_tx: txId, p_shares });
  return error;
}
