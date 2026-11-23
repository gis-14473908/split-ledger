import type { SupabaseClient } from "@supabase/supabase-js";
import type { Category } from "../categories";
import type { Contact, Transaction } from "../db/types";
import { normalizeMerchant } from "../dedupe";
import { historyHint } from "../hints";
import type { Share } from "../split/equal";
import { rpcSetSplit, type AaSave } from "./split";

export type DayEntry = { time: string | null; merchant: string; amountPence: number; isCurrent: boolean };

/** Items already read from a receipt for this bill (e.g. a receipt imported on its own). */
export type ReviewReceipt = {
  imagePath: string;
  model: string | null;
  lines: { name: string; pricePence: number; includesMe: boolean; contactIds: string[] }[];
};

export type ReviewItem = Transaction & { hint: string | null; sameDay: DayEntry[]; receipt: ReviewReceipt | null };

/** A past transaction that was already decided, used for the "last time here" hint. */
export type DecidedRow = {
  merchant_raw: string;
  occurred_on: string;
  amount_pence: number;
  status: string;
  splits: { contact_id: string | null }[];
};

type DayRow = Pick<Transaction, "id" | "occurred_on" | "occurred_at_time" | "merchant" | "amount_pence">;

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);

type PendingRow = Transaction & {
  receipts?:
    | { image_path: string; model_used: string | null; receipt_items: { name: string; price_pence: number; includes_me: boolean; contact_ids: string[]; position: number }[] }
    | { image_path: string; model_used: string | null; receipt_items: { name: string; price_pence: number; includes_me: boolean; contact_ids: string[]; position: number }[] }[]
    | null;
};

function readReceipt(r: PendingRow["receipts"]): ReviewReceipt | null {
  const one = Array.isArray(r) ? r[0] : r;
  if (!one) return null;
  return {
    imagePath: one.image_path,
    model: one.model_used,
    lines: [...one.receipt_items]
      .sort((a, b) => a.position - b.position)
      .map((i) => ({ name: i.name, pricePence: i.price_pence, includesMe: i.includes_me, contactIds: i.contact_ids })),
  };
}

export function buildReviewItems(
  pending: PendingRow[],
  decided: DecidedRow[], // newest first
  dayRows: DayRow[],
  contacts: Contact[],
): ReviewItem[] {
  const names = new Map(contacts.map((c) => [c.id, c.name]));
  const lastByMerchant = new Map<string, DecidedRow>();
  for (const d of decided) {
    const key = normalizeMerchant(d.merchant_raw);
    if (!lastByMerchant.has(key)) lastByMerchant.set(key, d);
  }

  return pending.map((tx) => {
    const past = lastByMerchant.get(normalizeMerchant(tx.merchant_raw));
    const hint = historyHint(
      past && (past.status === "shared" || past.status === "personal")
        ? {
            occurredOn: past.occurred_on,
            amountPence: past.amount_pence,
            status: past.status,
            contactNames: past.splits.flatMap((s) => (s.contact_id && names.has(s.contact_id) ? [names.get(s.contact_id)!] : [])),
          }
        : null,
      tx.ai_hint,
    );
    const sameDay = dayRows
      .filter((d) => d.occurred_on === tx.occurred_on)
      .sort((a, b) => (a.occurred_at_time ?? "99").localeCompare(b.occurred_at_time ?? "99"))
      .map((d) => ({ time: hhmm(d.occurred_at_time), merchant: d.merchant, amountPence: d.amount_pence, isCurrent: d.id === tx.id }));
    const { receipts, ...rest } = tx;
    return { ...rest, hint, sameDay, receipt: readReceipt(receipts) };
  });
}

export async function loadReviewData(sb: SupabaseClient): Promise<{ items: ReviewItem[]; contacts: Contact[] }> {
  const [pendingRes, decidedRes, contactsRes] = await Promise.all([
    sb
      .from("transactions")
      .select("*, receipts(image_path, model_used, receipt_items(name, price_pence, includes_me, contact_ids, position))")
      .in("status", ["pending", "later"])
      .order("occurred_on", { ascending: false })
      .order("occurred_at_time", { ascending: true, nullsFirst: false }),
    sb
      .from("transactions")
      .select("merchant_raw, occurred_on, amount_pence, status, splits(contact_id)")
      .in("status", ["personal", "shared"])
      .order("occurred_on", { ascending: false })
      .limit(500),
    sb.from("contacts").select("*").order("created_at"),
  ]);
  for (const r of [pendingRes, decidedRes, contactsRes]) if (r.error) throw new Error(r.error.message);

  const pending = (pendingRes.data ?? []) as PendingRow[];
  const days = [...new Set(pending.map((p) => p.occurred_on))];
  let dayRows: DayRow[] = [];
  if (days.length) {
    const { data, error } = await sb
      .from("transactions")
      .select("id, occurred_on, occurred_at_time, merchant, amount_pence")
      .in("occurred_on", days)
      .neq("status", "transfer");
    if (error) throw new Error(error.message);
    dayRows = data as DayRow[];
  }

  const contacts = (contactsRes.data ?? []) as Contact[];
  return { items: buildReviewItems(pending, (decidedRes.data ?? []) as DecidedRow[], dayRows, contacts), contacts };
}

async function setStatus(sb: SupabaseClient, txId: string, status: "personal" | "later") {
  const { error } = await sb.rpc("set_transaction_status", { p_tx: txId, p_status: status });
  if (error) throw new Error(error.message.includes("stale") ? STALE_MESSAGE : error.message);
}

export const STALE_MESSAGE = "这笔已经在别处处理过了，刷新一下";

export const savePersonal = (sb: SupabaseClient, txId: string) => setStatus(sb, txId, "personal");
export const saveLater = (sb: SupabaseClient, txId: string) => setStatus(sb, txId, "later");

export async function saveShares(sb: SupabaseClient, txId: string, shares: Share[], aa?: AaSave | null) {
  const error = await rpcSetSplit(sb, txId, shares, aa);
  if (error) throw new Error(error.message.includes("stale") ? STALE_MESSAGE : error.message);
}

export async function resetTx(sb: SupabaseClient, txId: string) {
  const { error } = await sb.rpc("reset_transaction", { p_tx: txId });
  if (error) throw new Error(error.message);
}

export async function updateCategory(sb: SupabaseClient, txId: string, category: Category) {
  const { error } = await sb.from("transactions").update({ category }).eq("id", txId);
  if (error) throw new Error(error.message);
}

export async function createContact(sb: SupabaseClient, name: string): Promise<Contact> {
  const { data, error } = await sb.from("contacts").insert({ name: name.trim() }).select("*").single();
  if (error || !data) throw new Error(error?.message ?? "创建联系人失败");
  return data as Contact;
}
