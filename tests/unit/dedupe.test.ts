import { expect, it } from "vitest";
import { dedupeKey, markDuplicates, normalizeMerchant } from "@/lib/dedupe";
import { tx } from "./fixtures";

it("normalizes merchant descriptions", () => {
  expect(normalizeMerchant("TESCO STORES 3021, Manchester")).toBe("tesco stores manchester");
  expect(normalizeMerchant("招商银行 消费")).toBe("招商银行 消费");
});

it("flags rows already in the ledger and repeats within the batch", () => {
  const existing = new Set([dedupeKey(tx())]);
  expect(markDuplicates([tx(), tx({ amountPence: 100 }), tx({ amountPence: 100 })], existing).map((x) => x.duplicate)).toEqual([
    true,
    false,
    true,
  ]);
});

it("treats the same merchant with a different store number as the same key", () => {
  expect(dedupeKey(tx({ merchantRaw: "TESCO 3021" }))).toBe(dedupeKey(tx({ merchantRaw: "Tesco 4410" })));
});
