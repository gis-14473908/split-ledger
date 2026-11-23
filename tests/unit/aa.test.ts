import { describe, expect, it } from "vitest";
import { aaPlan } from "@/lib/split/aa";
import type { ReceiptLine } from "@/lib/split/receipt";

// Four people, £100 receipt: a £60 sharing platter, then one £10, £15, £15 dish each for a, b, c.
const lines: ReceiptLine[] = [
  { id: "p", pricePence: 6000, includesMe: true, contactIds: ["a", "b", "c"] },
  { id: "a", pricePence: 1000, includesMe: false, contactIds: ["a"] },
  { id: "b", pricePence: 1500, includesMe: false, contactIds: ["b"] },
  { id: "c", pricePence: 1500, includesMe: false, contactIds: ["c"] },
];
const base = { lines, receiptTotalPence: 10000, billAmountPence: 10000, contactIds: ["a", "b", "c"], reconcile: "proportional" as const };
const share = (shares: { contactId: string | null; sharePence: number }[], id: string | null) =>
  shares.find((s) => s.contactId === id)?.sharePence;

describe("aaPlan", () => {
  it("each: bill shrinks to my part and friends carry only the difference", () => {
    const p = aaPlan({ ...base, mode: "each" });
    expect(p.amountPence).toBe(2500);
    // a ate 25.00 and paid 25.00; b and c ate 30.00 and paid 25.00; I ate 15.00 and paid 25.00
    expect(share(p.shares, "a")).toBe(0);
    expect(share(p.shares, "b")).toBe(500);
    expect(share(p.shares, "c")).toBe(500);
    expect(share(p.shares, null)).toBe(1500);
    expect(p.shares.reduce((s, x) => s + x.sharePence, 0)).toBe(p.amountPence);
    expect(p.paid).toEqual([]);
  });

  it("each: someone who ate less than their part is owed money (negative share)", () => {
    const light: ReceiptLine[] = [
      { id: "x", pricePence: 3000, includesMe: true, contactIds: [] },
      { id: "y", pricePence: 7000, includesMe: false, contactIds: ["a"] },
    ];
    const p = aaPlan({ ...base, lines: light, contactIds: ["a"], mode: "each" });
    // equal part £50. I ate 30 -> I overpaid 20; a ate 70 -> a owes 20.
    expect(p.amountPence).toBe(5000);
    expect(share(p.shares, "a")).toBe(2000);
    expect(share(p.shares, null)).toBe(3000);

    const flipped: ReceiptLine[] = [
      { id: "x", pricePence: 7000, includesMe: true, contactIds: [] },
      { id: "y", pricePence: 3000, includesMe: false, contactIds: ["a"] },
    ];
    const q = aaPlan({ ...base, lines: flipped, contactIds: ["a"], mode: "each" });
    expect(share(q.shares, "a")).toBe(-2000); // I owe a £20
    expect(share(q.shares, null)).toBe(7000);
    expect(q.shares.reduce((s, x) => s + x.sharePence, 0)).toBe(5000);
  });

  it("each: a friend with no items still appears, owed their whole part", () => {
    const solo: ReceiptLine[] = [{ id: "x", pricePence: 4000, includesMe: true, contactIds: [] }];
    const p = aaPlan({ ...base, lines: solo, receiptTotalPence: 4000, contactIds: ["a"], mode: "each" });
    expect(p.amountPence).toBe(2000);
    expect(share(p.shares, "a")).toBe(-2000);
    expect(share(p.shares, null)).toBe(4000);
  });

  it("each: odd pence stay balanced", () => {
    const l: ReceiptLine[] = [{ id: "x", pricePence: 1000, includesMe: true, contactIds: ["a", "b"] }];
    const p = aaPlan({ ...base, lines: l, receiptTotalPence: 1000, billAmountPence: 1000, contactIds: ["a", "b"], mode: "each" });
    expect(p.amountPence).toBe(334);
    expect(p.shares.reduce((s, x) => s + x.sharePence, 0)).toBe(334);
  });

  it("paid_all: normal shares, and each friend's equal part is what they already paid", () => {
    const p = aaPlan({ ...base, mode: "paid_all" });
    expect(p.amountPence).toBe(10000);
    expect(share(p.shares, null)).toBe(1500);
    expect(share(p.shares, "b")).toBe(3000);
    expect(p.shares.reduce((s, x) => s + x.sharePence, 0)).toBe(10000);
    expect(p.paid).toEqual([
      { contactId: "a", sharePence: 2500 },
      { contactId: "b", sharePence: 2500 },
      { contactId: "c", sharePence: 2500 },
    ]);
    // what is still owed: a 0, b 500, c 500
    const owed = (id: string) => share(p.shares, id)! - p.paid.find((x) => x.contactId === id)!.sharePence;
    expect([owed("a"), owed("b"), owed("c")]).toEqual([0, 500, 500]);
  });
});
