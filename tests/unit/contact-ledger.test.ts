import { expect, it } from "vitest";
import { buildContactLedger } from "@/lib/data/contacts";

it("merges both sides and settlements newest first with a running balance", () => {
  const ledger = buildContactLedger(
    [{ share_pence: 1000, transactions: { occurred_on: "2026-10-20", merchant: "Tesco", amount_pence: 2000 } }],
    [{ occurred_on: "2026-10-22", merchant: "Domino's", amount_pence: 2400, share_pence: 1200 }],
    [{ id: "s1", amount_pence: 300, settled_on: "2026-10-21", note: null }],
  );
  expect(ledger.entries).toEqual([
    { date: "2026-10-22", title: "Domino's", detail: "对方付的 £24.00", pence: -1200, kind: "iOwe" },
    { date: "2026-10-21", title: "对方转给你", detail: null, pence: -300, kind: "settlement" },
    { date: "2026-10-20", title: "Tesco", detail: "你付的 £20.00", pence: 1000, kind: "theyOwe" },
  ]);
  expect(ledger.balance).toBe(-500);
});

it("labels a payment I made to them", () => {
  const ledger = buildContactLedger([], [], [{ id: "s1", amount_pence: -400, settled_on: "2026-10-21", note: "现金" }]);
  expect(ledger.entries[0]).toMatchObject({ title: "你转给对方", detail: "现金", pence: 400 });
  expect(ledger.balance).toBe(400);
});

it("includes payments the other person recorded, from my point of view", () => {
  // They recorded +500: "the contact (me) paid me (them) £5" → I paid them, so they owe me £5 more.
  const ledger = buildContactLedger(
    [{ share_pence: 1000, transactions: { occurred_on: "2026-10-20", merchant: "Tesco", amount_pence: 2000 } }],
    [],
    [],
    [{ amount_pence: 500, settled_on: "2026-10-22", note: null }],
  );
  expect(ledger.entries[0]).toEqual({ date: "2026-10-22", title: "你转给对方", detail: "对方记录", pence: 500, kind: "settlement" });
  expect(ledger.balance).toBe(1500);
});

it("labels opening balances from either side", () => {
  const ledger = buildContactLedger(
    [],
    [],
    [{ id: "s1", amount_pence: -3000, settled_on: "2026-10-01", note: null, kind: "opening" }],
    [{ amount_pence: -500, settled_on: "2026-10-02", note: null, kind: "opening" }],
  );
  expect(ledger.entries).toEqual([
    { date: "2026-10-02", title: "起始欠款：你欠 TA", detail: "对方记录", pence: -500, kind: "settlement" },
    { date: "2026-10-01", title: "起始欠款：TA 欠你", detail: null, pence: 3000, kind: "settlement" },
  ]);
  expect(ledger.balance).toBe(2500);
});
