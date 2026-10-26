import { expect, it } from "vitest";
import { acceptInvite, createInviteLink, loadBalances, loadMonthlySpend } from "@/lib/data/dashboard";
import { recordingSupabase } from "./fake-supabase";

const contact = (id: string, name: string, linked: string | null = null) => ({
  id, owner_id: "me", name, linked_user_id: linked, invite_token: null, created_at: "",
});

it("reads balances from the database and orders by size", async () => {
  const sb = recordingSupabase({
    contacts: { data: [contact("c1", "孙豪", "u-b"), contact("c2", "李明"), contact("c3", "两清的人"), contact("c4", "没往来")], error: null },
    "rpc.contact_balances": {
      data: [
        { contact_id: "c1", pence: 800 },
        { contact_id: "c2", pence: -700 },
        { contact_id: "c3", pence: 0 },
      ],
      error: null,
    },
  });
  const rows = await loadBalances(sb as never);
  expect(rows.map((r) => [r.contact.name, r.pence])).toEqual([
    ["孙豪", 800],
    ["李明", -700],
    ["两清的人", 0],
  ]);
});

it("summarises the month's spend by category", async () => {
  const sb = recordingSupabase({
    "rpc.monthly_spend": {
      data: [
        { category: "groceries", pence: 834, pending_count: 2 },
        { category: "dining", pence: 1200, pending_count: 2 },
      ],
      error: null,
    },
  });
  expect(await loadMonthlySpend(sb as never, "2026-10")).toEqual({
    byCategory: [
      { category: "dining", pence: 1200 },
      { category: "groceries", pence: 834 },
    ],
    totalPence: 2034,
    pendingCount: 2,
  });
  expect(sb.rpcCalls[0]).toEqual({ fn: "monthly_spend", args: { p_month: "2026-10-01" } });
});

it("handles a month with no spend", async () => {
  const sb = recordingSupabase({ "rpc.monthly_spend": { data: [{ category: null, pence: 0, pending_count: 1 }], error: null } });
  expect(await loadMonthlySpend(sb as never, "2026-09")).toEqual({ byCategory: [], totalPence: 0, pendingCount: 1 });
});

it("builds a full invite link", async () => {
  const sb = recordingSupabase({ "rpc.create_invite": { data: "tok123", error: null } });
  expect(await createInviteLink(sb as never, "c1", "https://app.test")).toBe("https://app.test/invite/tok123");
});

it("turns invite errors into Chinese messages", async () => {
  const fail = (message: string) => recordingSupabase({ "rpc.accept_invite": { data: null, error: { message } } });
  expect(await acceptInvite(fail("invite_invalid") as never, "t")).toEqual({ ok: false, message: "链接已失效，请让对方重新生成" });
  expect(await acceptInvite(fail("invite_self") as never, "t")).toEqual({ ok: false, message: "这是你自己生成的邀请链接" });
  expect(await acceptInvite(fail("invite_already_linked") as never, "t")).toEqual({ ok: false, message: "你已经和对方关联过了" });
  const ok = recordingSupabase({ "rpc.accept_invite": { data: "c1", error: null } });
  expect(await acceptInvite(ok as never, "t")).toEqual({ ok: true });
  expect(ok.rpcCalls[0]).toEqual({ fn: "accept_invite", args: { p_token: "t", p_my_contact: null } });
});

it("links an existing contact when the accepter picks one", async () => {
  const ok = recordingSupabase({ "rpc.accept_invite": { data: "c1", error: null } });
  await acceptInvite(ok as never, "t", "mine-1");
  expect(ok.rpcCalls[0]).toEqual({ fn: "accept_invite", args: { p_token: "t", p_my_contact: "mine-1" } });
});
