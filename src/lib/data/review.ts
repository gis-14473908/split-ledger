import type { SupabaseClient } from "@supabase/supabase-js";
import type { Category } from "../categories";
import type { Contact, Transaction } from "../db/types";
import { normalizeMerchant } from "../dedupe";
import { historyHint } from "../hints";
import type { Share } from "../split/equal";

export type DayEntry = { time: string | null; merchant: string; amountPence: number; isCurrent: boolean };

export type ReviewItem = Transaction & { hint: string | null; sameDay: DayEntry[] };

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

export function buildReviewItems(
  pending: Transaction[],
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
    return { ...tx, hint, sameDay };
  });
}

export async function loadReviewData(sb: SupabaseClient): Promise<{ items: ReviewItem[]; contacts: Contact[] }> {
  const [pendingRes, decidedRes, contactsRes] = await Promise.all([
    sb
      .from("transactions")
      .select("*")
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

  const pending = (pendingRes.data ?? []) as Transaction[];
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
  const { error } = await sb.from("transactions").update({ status }).eq("id", txId);
  if (error) throw new Error(error.message);
}

export const savePersonal = (sb: SupabaseClient, txId: string) => setStatus(sb, txId, "personal");
export const saveLater = (sb: SupabaseClient, txId: string) => setStatus(sb, txId, "later");

export async function saveShares(sb: SupabaseClient, txId: string, shares: Share[]) {
  const { error } = await sb.rpc("set_transaction_split", {
    p_tx: txId,
    p_shares: shares.map((s) => ({ contact_id: s.contactId, share_pence: s.sharePence })),
  });
  if (error) throw new Error(error.message);
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
