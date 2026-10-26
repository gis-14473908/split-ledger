import { expect, it, vi } from "vitest";
import { fillCategories } from "@/lib/import/categorize";
import { tx } from "./fixtures";

it("asks once for every row without a category and fills them in order", async () => {
  const ask = vi.fn(async () => ["groceries", "dining"] as const);
  const rows = [tx({ merchant: "Tesco", category: null }), tx({ merchant: "Transfer", category: "transfer" }), tx({ merchant: "Wagamama", category: null, amountPence: 1200 })];
  const out = await fillCategories(rows, ask as never);
  expect(ask).toHaveBeenCalledTimes(1);
  expect(ask).toHaveBeenCalledWith([{ merchant: "Tesco", amountPence: 2345 }, { merchant: "Wagamama", amountPence: 1200 }]);
  expect(out.rows.map((r) => r.category)).toEqual(["groceries", "transfer", "dining"]);
  expect(out.failed).toBe(false);
});

it("falls back to 'other' when the AI call fails", async () => {
  const out = await fillCategories([tx({ category: null })], async () => {
    throw new Error("rate limited");
  });
  expect(out.rows[0].category).toBe("other");
  expect(out.failed).toBe(true);
});

it("skips the call when nothing needs a category", async () => {
  const ask = vi.fn();
  await fillCategories([tx({ category: "groceries" })], ask);
  expect(ask).not.toHaveBeenCalled();
});
