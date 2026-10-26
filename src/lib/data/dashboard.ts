import type { SupabaseClient } from "@supabase/supabase-js";
import { isCategory, type Category } from "../categories";
import type { Contact } from "../db/types";

export type BalanceRow = { contact: Contact; pence: number };

/** Net balance per contact (positive: they owe me), aggregated in SQL by contact_balances(). */
export async function loadBalances(sb: SupabaseClient): Promise<BalanceRow[]> {
  const [contactsRes, balancesRes] = await Promise.all([sb.from("contacts").select("*"), sb.rpc("contact_balances")]);
  for (const r of [contactsRes, balancesRes]) if (r.error) throw new Error(r.error.message);

  const pence = new Map(((balancesRes.data ?? []) as { contact_id: string; pence: number | string }[]).map((b) => [b.contact_id, Number(b.pence)]));
  return ((contactsRes.data ?? []) as Contact[])
    .filter((c) => pence.has(c.id))
    .map((contact) => ({ contact, pence: pence.get(contact.id)! }))
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
  invalid_contact: "选的联系人已经关联了别人，换一个或新建",
};

export async function acceptInvite(
  sb: SupabaseClient,
  token: string,
  myContactId: string | null = null,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await sb.rpc("accept_invite", { p_token: token, p_my_contact: myContactId });
  if (!error) return { ok: true };
  const code = Object.keys(INVITE_ERRORS).find((k) => error.message.includes(k));
  return { ok: false, message: code ? INVITE_ERRORS[code] : `关联失败：${error.message}` };
}

/** Name of whoever sent the invite, or null when the link is invalid. */
export async function inviteInfo(sb: SupabaseClient, token: string): Promise<string | null> {
  const { data, error } = await sb.rpc("invite_info", { p_token: token });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}
