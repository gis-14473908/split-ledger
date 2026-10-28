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
  /** What a tap opens: my own bill or settlement. Entries the other person recorded have none. */
  ref?: { type: "bill"; id: string } | { type: "settlement"; settlement: SettlementRow };
};

type MySplit = {
  share_pence: number;
  transactions: { id: string; occurred_on: string; merchant: string; amount_pence: number };
  /** What this contact had, when the bill was split from a receipt. */
  itemNames?: string[];
};
type ReceiptEmbed = { receipt_items: { name: string; contact_ids: string[]; includes_me: boolean; position?: number }[] };

/** Item names on a receipt that include this contact; shared items are marked. */
export function itemsFor(receipts: ReceiptEmbed | ReceiptEmbed[] | null | undefined, contactId: string): string[] {
  const r = Array.isArray(receipts) ? receipts[0] : receipts;
  return [...(r?.receipt_items ?? [])]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .filter((i) => i.contact_ids.includes(contactId))
    .map((i) => (i.contact_ids.length + (i.includes_me ? 1 : 0) > 1 ? `${i.name}（合）` : i.name));
}
type TheirShare = Pick<OwedShare, "occurred_on" | "merchant" | "amount_pence" | "share_pence">;
export type SettlementKind = "payment" | "opening";
export type SettlementRow = { id: string; amount_pence: number; settled_on: string; note: string | null; kind?: SettlementKind };
/** A settlement the other person recorded; positive means I paid them. */
type TheirSettlement = { amount_pence: number; settled_on: string; note: string | null; kind?: SettlementKind };

const openingTitle = (pence: number) => (pence > 0 ? "起始欠款：TA 欠你" : "起始欠款：你欠 TA");

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
      detail: `你付的 ${formatPence(s.transactions.amount_pence)}${s.itemNames?.length ? ` · ${s.itemNames.join("、")}` : ""}`,
      pence: s.share_pence,
      kind: "theyOwe" as const,
      ref: { type: "bill" as const, id: s.transactions.id },
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
      title: s.kind === "opening" ? openingTitle(-s.amount_pence) : s.amount_pence > 0 ? "对方转给你" : "你转给对方",
      detail: s.note,
      pence: -s.amount_pence,
      kind: "settlement" as const,
      ref: { type: "settlement" as const, settlement: s },
    })),
    ...theirSettlements.map((s) => ({
      date: s.settled_on,
      title: s.kind === "opening" ? openingTitle(s.amount_pence) : s.amount_pence > 0 ? "你转给对方" : "对方转给你",
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
      .select(
        "share_pence, transactions!inner(id, occurred_on, merchant, amount_pence, status, receipts(receipt_items(name, contact_ids, includes_me, position)))",
      )
      .eq("contact_id", contactId)
      .eq("transactions.status", "shared"),
    c.linked_user_id ? sb.rpc("shares_owed_by_me") : none,
    sb.from("settlements").select("id, amount_pence, settled_on, note, kind").eq("contact_id", contactId),
    c.linked_user_id ? sb.rpc("counterpart_settlements") : none,
  ]);
  for (const r of [mineRes, theirsRes, settlementsRes, theirSettlementsRes]) if (r.error) throw new Error(r.error.message);

  const byThem = <T extends { owner_id: string }>(rows: T[]) => rows.filter((s) => s.owner_id === c.linked_user_id);
  return {
    contact: c,
    ...buildContactLedger(
      ((mineRes.data ?? []) as unknown as (MySplit & { transactions: { receipts?: ReceiptEmbed | ReceiptEmbed[] } })[]).map(
        (s) => ({ ...s, itemNames: itemsFor(s.transactions.receipts, contactId) }),
      ),
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

/** Same sign rule as settle(): positive means they paid me (or, for an opening balance, I owed them). */
export async function updateSettlement(
  sb: SupabaseClient,
  id: string,
  patch: { amountPence: number; settledOn: string; note: string },
) {
  if (patch.amountPence === 0) throw new Error("金额不能是 0，不要这条记录的话请删除");
  const { error } = await sb
    .from("settlements")
    .update({ amount_pence: patch.amountPence, settled_on: patch.settledOn, note: patch.note.trim() || null })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteSettlement(sb: SupabaseClient, id: string) {
  const { error } = await sb.from("settlements").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export type OpeningBalance = { direction: "theyOwe" | "iOwe"; pence: number };

/** Create a contact, optionally with a debt that predates the app. */
export async function addContact(sb: SupabaseClient, name: string, opening?: OpeningBalance): Promise<Contact> {
  const { data, error } = await sb.from("contacts").insert({ name: name.trim() }).select("*").single();
  if (error || !data) throw new Error(error?.message ?? "添加联系人失败");
  const contact = data as Contact;
  if (opening && opening.pence > 0) {
    const { error: e2 } = await sb.from("settlements").insert({
      contact_id: contact.id,
      // Same sign rule as payments: negative means they owe me.
      amount_pence: opening.direction === "theyOwe" ? -opening.pence : opening.pence,
      kind: "opening",
    });
    if (e2) throw new Error(`联系人已添加，但起始欠款没保存：${e2.message}`);
  }
  return contact;
}
