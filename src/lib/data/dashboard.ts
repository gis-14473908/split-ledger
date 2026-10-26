import type { SupabaseClient } from "@supabase/supabase-js";
import { computeBalances } from "../balance";
import { isCategory, type Category } from "../categories";
import type { Contact } from "../db/types";

export type BalanceRow = { contact: Contact; pence: number };

export async function loadBalances(sb: SupabaseClient): Promise<BalanceRow[]> {
  const [contactsRes, splitsRes, owedRes, settlementsRes] = await Promise.all([
    sb.from("contacts").select("*"),
    sb.from("splits").select("contact_id, share_pence").not("contact_id", "is", null),
    sb.rpc("shares_owed_by_me"),
    sb.from("settlements").select("contact_id, amount_pence"),
  ]);
  for (const r of [contactsRes, splitsRes, owedRes, settlementsRes]) if (r.error) throw new Error(r.error.message);

  const contacts = (contactsRes.data ?? []) as Contact[];
  const byLinkedUser = new Map(contacts.filter((c) => c.linked_user_id).map((c) => [c.linked_user_id!, c.id]));

  const balances = computeBalances({
    owedToMe: (splitsRes.data ?? []).map((s: { contact_id: string; share_pence: number }) => ({ contactId: s.contact_id, sharePence: s.share_pence })),
    owedByMe: ((owedRes.data ?? []) as { owner_id: string; share_pence: number }[]).flatMap((s) =>
      byLinkedUser.has(s.owner_id) ? [{ contactId: byLinkedUser.get(s.owner_id)!, sharePence: s.share_pence }] : [],
    ),
    settlements: (settlementsRes.data ?? []).map((s: { contact_id: string; amount_pence: number }) => ({ contactId: s.contact_id, amountPence: s.amount_pence })),
  });

  return contacts
    .filter((c) => c.id in balances)
    .map((contact) => ({ contact, pence: balances[contact.id] }))
    .sort((a, b) => Math.abs(b.pence) - Math.abs(a.pence));
}

export type MonthlySpend = { byCategory: { category: Category; pence: number }[]; totalPence: number; pendingCount: number };

export async function loadMonthlySpend(sb: SupabaseClient, month: string /* YYYY-MM */): Promise<MonthlySpend> {
  const { data, error } = await sb.rpc("monthly_spend", { p_month: `${month}-01` });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { category: string | null; pence: number | string; pending_count: number }[];
  const byCategory = rows
    .flatMap((r) => (isCategory(r.category) && Number(r.pence) > 0 ? [{ category: r.category, pence: Number(r.pence) }] : []))
    .sort((a, b) => b.pence - a.pence);
  return {
    byCategory,
    totalPence: byCategory.reduce((s, r) => s + r.pence, 0),
    pendingCount: rows[0]?.pending_count ?? 0,
  };
}

export async function createInviteLink(sb: SupabaseClient, contactId: string, origin: string): Promise<string> {
  const { data, error } = await sb.rpc("create_invite", { p_contact: contactId });
  if (error) throw new Error(error.message);
  return `${origin}/invite/${data}`;
}

const INVITE_ERRORS: Record<string, string> = {
  invite_invalid: "链接已失效，请让对方重新生成",
  invite_self: "这是你自己生成的邀请链接",
  invite_already_linked: "你已经和对方关联过了",
};

export async function acceptInvite(sb: SupabaseClient, token: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await sb.rpc("accept_invite", { p_token: token });
  if (!error) return { ok: true };
  const code = Object.keys(INVITE_ERRORS).find((k) => error.message.includes(k));
  return { ok: false, message: code ? INVITE_ERRORS[code] : `关联失败：${error.message}` };
}
