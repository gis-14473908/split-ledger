import { expect, it } from "vitest";
import { buildReviewItems } from "@/lib/data/review";
import type { Contact, Transaction } from "@/lib/db/types";

const t = (o: Partial<Transaction>): Transaction => ({
  id: "t", owner_id: "me", import_id: null, occurred_on: "2026-10-22", occurred_at_time: null,
  merchant_raw: "TESCO 3021", merchant: "Tesco", location: null, amount_pence: 2345,
  original_amount: null, original_currency: null, category: "groceries", bank: "monzo",
  source: "screenshot", status: "pending", ai_hint: null, dedupe_key: "k", created_at: "", ...o,
});
const contact = (id: string, name: string): Contact => ({ id, owner_id: "me", name, linked_user_id: null, invite_token: null, created_at: "" });

it("hints with the most recent decision at the same merchant", () => {
  const items = buildReviewItems(
    [t({ id: "p1" })],
    [
      { merchant_raw: "Tesco 4410", occurred_on: "2026-10-15", amount_pence: 1820, status: "shared", splits: [{ contact_id: null }, { contact_id: "c1" }] },
      { merchant_raw: "TESCO 3021", occurred_on: "2026-10-01", amount_pence: 500, status: "personal", splits: [] },
    ],
    [],
    [contact("c1", "孙豪")],
  );
  expect(items[0].hint).toBe("上次在这家：10月15日 £18.20，和孙豪分账");
});

it("falls back to the AI hint", () => {
  const items = buildReviewItems([t({ id: "p1", merchant_raw: "NANDOS", ai_hint: "可能是聚餐" })], [], [], []);
  expect(items[0].hint).toBe("可能是聚餐");
});

it("lists the day's spending by time with the current card marked", () => {
  const p = t({ id: "p1", occurred_at_time: "19:42:00" });
  const items = buildReviewItems(
    [p],
    [],
    [p, t({ id: "x", merchant: "Pret", amount_pence: 680, occurred_at_time: "12:31:00" }), t({ id: "y", merchant: "Spotify", amount_pence: 599 })],
    [],
  );
  expect(items[0].sameDay).toEqual([
    { time: "12:31", merchant: "Pret", amountPence: 680, isCurrent: false },
    { time: "19:42", merchant: "Tesco", amountPence: 2345, isCurrent: true },
    { time: null, merchant: "Spotify", amountPence: 599, isCurrent: false },
  ]);
});
