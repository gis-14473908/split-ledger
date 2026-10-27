import type { SupabaseClient } from "@supabase/supabase-js";
import type { Category } from "../categories";
import type { Contact, Transaction, TxStatus } from "../db/types";
import { dedupeKey } from "../dedupe";
import { formatPence } from "../money";

export type Bill = Transaction & { splits: { contact_id: string | null; share_pence: number }[] };

export type BillFilter = "all" | "shared" | "personal" | "transfer" | "pending";

export const FILTER_LABEL: Record<BillFilter, string> = {
  all: "全部",
  shared: "一起的",
  personal: "我自己的",
  transfer: "转账/收入",
  pending: "待确认",
};

export const STATUS_LABEL: Record<TxStatus, string> = {
  pending: "待确认",
  later: "稍后再说",
  personal: "我自己的",
  shared: "一起的",
  transfer: "转账/收入",
};

export const SPLIT_LOCKED_MESSAGE = "这笔已经分过账了，先点「重新分账」再改金额";

export function filterBills(bills: Bill[], filter: BillFilter): Bill[] {
  if (filter === "all") return bills;
  if (filter === "pending") return bills.filter((b) => b.status === "pending" || b.status === "later");
  return bills.filter((b) => b.status === filter);
}

/** Newest month first; spending counts positive amounts that aren't transfers. */
export function groupByMonth(bills: Bill[]) {
  const months = new Map<string, Bill[]>();
  for (const b of [...bills].sort((x, y) => y.occurred_on.localeCompare(x.occurred_on))) {
    const key = b.occurred_on.slice(0, 7);
    months.set(key, [...(months.get(key) ?? []), b]);
  }
  return [...months].map(([month, list]) => ({
    month,
    label: `${Number(month.slice(0, 4))}年${Number(month.slice(5, 7))}月`,
    bills: list,
    spentPence: list.filter((b) => b.status !== "transfer" && b.amount_pence > 0).reduce((s, b) => s + b.amount_pence, 0),
  }));
}

/** "和 小明、小红 分 · 你 £3.00", or null when the bill isn't split. */
export function splitSummary(bill: Bill, contacts: Contact[]): string | null {
  if (bill.status !== "shared" || bill.splits.length === 0) return null;
  const names = bill.splits
    .filter((s) => s.contact_id)
    .map((s) => contacts.find((c) => c.id === s.contact_id)?.name ?? "?");
  const mine = bill.splits.find((s) => s.contact_id === null)?.share_pence ?? 0;
  return `和 ${names.join("、")} 分 · 你 ${formatPence(mine)}`;
}

export async function loadBills(sb: SupabaseClient) {
  const [billsRes, contactsRes] = await Promise.all([
    sb
      .from("transactions")
      .select("*, splits(contact_id, share_pence)")
      .order("occurred_on", { ascending: false })
      .order("occurred_at_time", { ascending: false, nullsFirst: false })
      .limit(2000),
    sb.from("contacts").select("*").order("created_at"),
  ]);
  for (const r of [billsRes, contactsRes]) if (r.error) throw new Error(r.error.message);
  return { bills: (billsRes.data ?? []) as Bill[], contacts: (contactsRes.data ?? []) as Contact[] };
}

export type BillPatch = { merchant?: string; occurredOn?: string; category?: Category; amountPence?: number };

export async function updateBill(sb: SupabaseClient, bill: Bill, patch: BillPatch) {
  const amountChanged = patch.amountPence !== undefined && patch.amountPence !== bill.amount_pence;
  if (amountChanged && bill.splits.length > 0) throw new Error(SPLIT_LOCKED_MESSAGE);
  const row: Record<string, unknown> = {};
  if (patch.merchant !== undefined) row.merchant = patch.merchant.trim() || bill.merchant;
  if (patch.occurredOn !== undefined) row.occurred_on = patch.occurredOn;
  if (patch.category !== undefined) row.category = patch.category;
  if (amountChanged) row.amount_pence = patch.amountPence;
  if (Object.keys(row).length === 0) return;
  const { error } = await sb.from("transactions").update(row).eq("id", bill.id);
  if (error) throw new Error(error.message.includes("locked") ? SPLIT_LOCKED_MESSAGE : error.message);
}

/** Move a bill to another bucket. A shared bill loses its split first (it goes back to pending). */
export async function changeBillStatus(sb: SupabaseClient, bill: Bill, status: "pending" | "personal" | "transfer") {
  if (bill.status === "shared" || bill.splits.length > 0) {
    const { error } = await sb.rpc("reset_transaction", { p_tx: bill.id });
    if (error) throw new Error(error.message);
  }
  if (status === "pending" && (bill.status === "shared" || bill.splits.length > 0)) return;
  const { error } = await sb.from("transactions").update({ status }).eq("id", bill.id);
  if (error) throw new Error(error.message);
}

export async function deleteBill(sb: SupabaseClient, id: string) {
  const { error } = await sb.from("transactions").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export type ManualBill = { merchant: string; occurredOn: string; amountPence: number; category: Category };

/** A bill typed in by hand. It lands in the review queue like an imported one. */
export async function addManualBill(sb: SupabaseClient, b: ManualBill) {
  const merchant = b.merchant.trim();
  const transfer = b.category === "transfer" || b.amountPence < 0;
  const { error } = await sb.from("transactions").insert({
    occurred_on: b.occurredOn,
    merchant_raw: merchant,
    merchant,
    amount_pence: b.amountPence,
    category: b.category,
    source: "manual",
    status: transfer ? "transfer" : "pending",
    dedupe_key: dedupeKey({ occurredOn: b.occurredOn, amountPence: b.amountPence, merchantRaw: merchant }),
  });
  if (error) throw new Error(error.message);
}
