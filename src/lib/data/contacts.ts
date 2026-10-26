import type { SupabaseClient } from "@supabase/supabase-js";
import type { Contact, OwedShare } from "../db/types";
import { formatPence } from "../money";

export type LedgerEntry = {
  date: string;
  title: string;
  detail: string | null;
  /** Effect on what this contact owes me: positive raises it. */
  pence: number;
  kind: "theyOwe" | "iOwe" | "settlement";
};

type MySplit = { share_pence: number; transactions: { occurred_on: string; merchant: string; amount_pence: number } };
type TheirShare = Pick<OwedShare, "occurred_on" | "merchant" | "amount_pence" | "share_pence">;
type SettlementRow = { id: string; amount_pence: number; settled_on: string; note: string | null };
/** A settlement the other person recorded; positive means I paid them. */
type TheirSettlement = { amount_pence: number; settled_on: string; note: string | null };

export function buildContactLedger(
  mine: MySplit[],
  theirs: TheirShare[],
  settlements: SettlementRow[],
  theirSettlements: TheirSettlement[] = [],
) {
  const entries: LedgerEntry[] = [
    ...mine.map((s) => ({
      date: s.transactions.occurred_on,
      title: s.transactions.merchant,
      detail: `你付的 ${formatPence(s.transactions.amount_pence)}`,
      pence: s.share_pence,
      kind: "theyOwe" as const,
    })),
    ...theirs.map((s) => ({
      date: s.occurred_on,
      title: s.merchant,
      detail: `对方付的 ${formatPence(s.amount_pence)}`,
      pence: -s.share_pence,
      kind: "iOwe" as const,
    })),
    ...settlements.map((s) => ({
      date: s.settled_on,
      title: s.amount_pence > 0 ? "对方转给你" : "你转给对方",
      detail: s.note,
      pence: -s.amount_pence,
      kind: "settlement" as const,
    })),
    ...theirSettlements.map((s) => ({
      date: s.settled_on,
      title: s.amount_pence > 0 ? "你转给对方" : "对方转给你",
      detail: s.note ? `对方记录 · ${s.note}` : "对方记录",
      pence: s.amount_pence,
      kind: "settlement" as const,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  return { entries, balance: entries.reduce((s, e) => s + e.pence, 0) };
}

export async function loadContactDetail(sb: SupabaseClient, contactId: string) {
  const { data: contact, error } = await sb.from("contacts").select("*").eq("id", contactId).single();
  if (error || !contact) throw new Error(error?.message ?? "找不到这个联系人");
  const c = contact as Contact;

  const none = Promise.resolve({ data: [], error: null });
  const [mineRes, theirsRes, settlementsRes, theirSettlementsRes] = await Promise.all([
    sb
      .from("splits")
      .select("share_pence, transactions!inner(occurred_on, merchant, amount_pence, status)")
      .eq("contact_id", contactId)
      .eq("transactions.status", "shared"),
    c.linked_user_id ? sb.rpc("shares_owed_by_me") : none,
    sb.from("settlements").select("id, amount_pence, settled_on, note").eq("contact_id", contactId),
    c.linked_user_id ? sb.rpc("counterpart_settlements") : none,
  ]);
  for (const r of [mineRes, theirsRes, settlementsRes, theirSettlementsRes]) if (r.error) throw new Error(r.error.message);

  const byThem = <T extends { owner_id: string }>(rows: T[]) => rows.filter((s) => s.owner_id === c.linked_user_id);
  return {
    contact: c,
    ...buildContactLedger(
      (mineRes.data ?? []) as unknown as MySplit[],
      byThem((theirsRes.data ?? []) as OwedShare[]),
      (settlementsRes.data ?? []) as SettlementRow[],
      byThem((theirSettlementsRes.data ?? []) as (TheirSettlement & { owner_id: string })[]),
    ),
  };
}

/** Positive amount: they paid me. Negative: I paid them. */
export async function settle(sb: SupabaseClient, contactId: string, amountPence: number, note?: string) {
  const { error } = await sb.from("settlements").insert({ contact_id: contactId, amount_pence: amountPence, note: note || null });
  if (error) throw new Error(error.message);
}
