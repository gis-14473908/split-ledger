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

export function buildContactLedger(mine: MySplit[], theirs: TheirShare[], settlements: SettlementRow[]) {
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
  ].sort((a, b) => b.date.localeCompare(a.date));
  return { entries, balance: entries.reduce((s, e) => s + e.pence, 0) };
}

export async function loadContactDetail(sb: SupabaseClient, contactId: string) {
  const { data: contact, error } = await sb.from("contacts").select("*").eq("id", contactId).single();
  if (error || !contact) throw new Error(error?.message ?? "找不到这个联系人");
  const c = contact as Contact;

  const [mineRes, theirsRes, settlementsRes] = await Promise.all([
    sb.from("splits").select("share_pence, transactions(occurred_on, merchant, amount_pence)").eq("contact_id", contactId),
    c.linked_user_id ? sb.rpc("shares_owed_by_me") : Promise.resolve({ data: [], error: null }),
    sb.from("settlements").select("id, amount_pence, settled_on, note").eq("contact_id", contactId),
  ]);
  for (const r of [mineRes, theirsRes, settlementsRes]) if (r.error) throw new Error(r.error.message);

  const theirs = ((theirsRes.data ?? []) as OwedShare[]).filter((s) => s.owner_id === c.linked_user_id);
  return { contact: c, ...buildContactLedger((mineRes.data ?? []) as unknown as MySplit[], theirs, (settlementsRes.data ?? []) as SettlementRow[]) };
}

/** Positive amount: they paid me. Negative: I paid them. */
export async function settle(sb: SupabaseClient, contactId: string, amountPence: number, note?: string) {
  const { error } = await sb.from("settlements").insert({ contact_id: contactId, amount_pence: amountPence, note: note || null });
  if (error) throw new Error(error.message);
}
