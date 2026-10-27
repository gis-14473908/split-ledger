import { describe, expect, it } from "vitest";
import {
  addManualBill,
  changeBillStatus,
  deleteBill,
  filterBills,
  groupByMonth,
  splitSummary,
  updateBill,
  type Bill,
} from "@/lib/data/bills";
import { deleteSettlement, updateSettlement } from "@/lib/data/contacts";
import type { Contact } from "@/lib/db/types";
import { recordingSupabase } from "./fake-supabase";

const bill = (over: Partial<Bill>): Bill =>
  ({
    id: "t1",
    occurred_on: "2026-10-20",
    merchant: "Tesco",
    merchant_raw: "TESCO",
    amount_pence: 1000,
    category: "groceries",
    status: "personal",
    splits: [],
    ...over,
  }) as Bill;

const contacts = [
  { id: "c1", name: "小明" },
  { id: "c2", name: "小红" },
] as Contact[];

describe("bill list helpers", () => {
  const bills = [
    bill({ id: "a", status: "shared", occurred_on: "2026-09-30" }),
    bill({ id: "b", status: "personal", occurred_on: "2026-10-02" }),
    bill({ id: "c", status: "transfer", amount_pence: -5000, occurred_on: "2026-10-03" }),
    bill({ id: "d", status: "later", occurred_on: "2026-10-04" }),
    bill({ id: "e", status: "pending", occurred_on: "2026-10-05" }),
  ];

  it("filters by bucket, with later counted as waiting", () => {
    expect(filterBills(bills, "all")).toHaveLength(5);
    expect(filterBills(bills, "shared").map((b) => b.id)).toEqual(["a"]);
    expect(filterBills(bills, "pending").map((b) => b.id)).toEqual(["d", "e"]);
    expect(filterBills(bills, "transfer").map((b) => b.id)).toEqual(["c"]);
  });

  it("groups newest month first and leaves transfers out of spending", () => {
    const groups = groupByMonth(bills);
    expect(groups.map((g) => g.label)).toEqual(["2026年10月", "2026年9月"]);
    expect(groups[0].bills.map((b) => b.id)).toEqual(["e", "d", "c", "b"]);
    expect(groups[0].spentPence).toBe(3000);
  });

  it("summarises who shared a bill and my part", () => {
    const shared = bill({
      status: "shared",
      splits: [
        { contact_id: null, share_pence: 334 },
        { contact_id: "c1", share_pence: 333 },
        { contact_id: "c2", share_pence: 333 },
      ],
    });
    expect(splitSummary(shared, contacts)).toBe("和 小明、小红 分 · 你 £3.34");
    expect(splitSummary(bill({}), contacts)).toBeNull();
  });
});

describe("editing bills", () => {
  it("updates merchant, date and category directly", async () => {
    const sb = recordingSupabase();
    await updateBill(sb as never, bill({}), { merchant: " Aldi ", occurredOn: "2026-10-21", category: "dining" });
    expect(sb.calls).toContainEqual({
      table: "transactions",
      op: "update",
      args: [{ merchant: "Aldi", occurred_on: "2026-10-21", category: "dining" }],
    });
  });

  it("refuses to change the amount of a split bill", async () => {
    const sb = recordingSupabase();
    const shared = bill({ status: "shared", splits: [{ contact_id: "c1", share_pence: 500 }] });
    await expect(updateBill(sb as never, shared, { amountPence: 1200 })).rejects.toThrow("重新分账");
    expect(sb.calls).toEqual([]);
  });

  it("clears the split before moving a shared bill elsewhere", async () => {
    const sb = recordingSupabase();
    const shared = bill({ status: "shared", splits: [{ contact_id: "c1", share_pence: 500 }] });
    await changeBillStatus(sb as never, shared, "personal");
    expect(sb.rpcCalls).toEqual([{ fn: "reset_transaction", args: { p_tx: "t1" } }]);
    expect(sb.calls).toContainEqual({ table: "transactions", op: "update", args: [{ status: "personal" }] });
  });

  it("re-splitting a shared bill only resets it", async () => {
    const sb = recordingSupabase();
    await changeBillStatus(sb as never, bill({ status: "shared", splits: [{ contact_id: "c1", share_pence: 1 }] }), "pending");
    expect(sb.rpcCalls).toHaveLength(1);
    expect(sb.calls).toEqual([]);
  });

  it("moves an unsplit bill with a plain update", async () => {
    const sb = recordingSupabase();
    await changeBillStatus(sb as never, bill({ status: "personal" }), "transfer");
    expect(sb.rpcCalls).toEqual([]);
    expect(sb.calls).toContainEqual({ table: "transactions", op: "update", args: [{ status: "transfer" }] });
  });

  it("deletes a bill", async () => {
    const sb = recordingSupabase();
    await deleteBill(sb as never, "t9");
    expect(sb.calls).toEqual([
      { table: "transactions", op: "delete", args: [] },
      { table: "transactions", op: "eq", args: ["id", "t9"] },
    ]);
  });

  it("adds a hand-typed bill to the review queue", async () => {
    const sb = recordingSupabase();
    await addManualBill(sb as never, { merchant: "奶茶", occurredOn: "2026-10-25", amountPence: 650, category: "dining" });
    expect(sb.calls[0]).toMatchObject({
      op: "insert",
      args: [{ merchant: "奶茶", merchant_raw: "奶茶", amount_pence: 650, source: "manual", status: "pending", dedupe_key: "2026-10-25|650|奶茶" }],
    });
  });
});

describe("editing settlements", () => {
  it("updates amount, date and note", async () => {
    const sb = recordingSupabase();
    await updateSettlement(sb as never, "s1", { amountPence: -1500, settledOn: "2026-10-01", note: " " });
    expect(sb.calls[0]).toEqual({
      table: "settlements",
      op: "update",
      args: [{ amount_pence: -1500, settled_on: "2026-10-01", note: null }],
    });
  });

  it("refuses a zero amount and deletes on request", async () => {
    const sb = recordingSupabase();
    await expect(updateSettlement(sb as never, "s1", { amountPence: 0, settledOn: "2026-10-01", note: "" })).rejects.toThrow("删除");
    await deleteSettlement(sb as never, "s1");
    expect(sb.calls).toEqual([
      { table: "settlements", op: "delete", args: [] },
      { table: "settlements", op: "eq", args: ["id", "s1"] },
    ]);
  });
});
