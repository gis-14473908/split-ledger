import { describe, expect, it } from "vitest";
import { equalSplit } from "@/lib/split/equal";
import { receiptSplit, unassignedLines, type ReceiptLine } from "@/lib/split/receipt";

const sum = (xs: { sharePence: number }[]) => xs.reduce((s, x) => s + x.sharePence, 0);

describe("equalSplit", () => {
  it("gives the remainder to me", () => {
    expect(equalSplit(1000, [null, "a", "b"])).toEqual([
      { contactId: null, sharePence: 334 },
      { contactId: "a", sharePence: 333 },
      { contactId: "b", sharePence: 333 },
    ]);
    expect(equalSplit(1001, ["a", "b", null]).find((s) => s.contactId === null)!.sharePence).toBe(335);
  });
  it("gives the remainder to the first participant when I am not included", () => {
    expect(equalSplit(1001, ["a", "b"])).toEqual([
      { contactId: "a", sharePence: 501 },
      { contactId: "b", sharePence: 500 },
    ]);
  });
  it("rejects empty or duplicate participants", () => {
    expect(() => equalSplit(100, [])).toThrow();
    expect(() => equalSplit(100, ["a", "a"])).toThrow();
  });
});

describe("receiptSplit", () => {
  const lines: ReceiptLine[] = [
    { id: "milk", pricePence: 150, includesMe: true, contactIds: [] },
    { id: "beer", pricePence: 600, includesMe: false, contactIds: ["a"] },
    { id: "bread", pricePence: 100, includesMe: true, contactIds: ["a"] },
  ];

  it("sums each person's items, sharing joint items equally", () => {
    expect(receiptSplit(lines, 850, "me")).toEqual([
      { contactId: null, sharePence: 200 },
      { contactId: "a", sharePence: 650 },
    ]);
  });
  it("spreads a bank/receipt difference in proportion to subtotals", () => {
    const p = receiptSplit(lines, 935, "proportional");
    expect(sum(p)).toBe(935);
    expect(p).toEqual([
      { contactId: null, sharePence: 220 },
      { contactId: "a", sharePence: 715 },
    ]);
  });
  it("puts a discount on me in 'me' mode", () => {
    expect(receiptSplit(lines, 800, "me")[0].sharePence).toBe(150);
  });
  it("keeps proportional totals exact when the difference does not divide evenly", () => {
    const three: ReceiptLine[] = [
      { id: "x", pricePence: 100, includesMe: true, contactIds: [] },
      { id: "y", pricePence: 100, includesMe: false, contactIds: ["a"] },
      { id: "z", pricePence: 100, includesMe: false, contactIds: ["b"] },
    ];
    expect(sum(receiptSplit(three, 301, "proportional"))).toBe(301);
    expect(sum(receiptSplit(three, 299, "proportional"))).toBe(299);
  });
  it("adds a 'me' share in 'me' mode even when I bought nothing", () => {
    const onlyA: ReceiptLine[] = [{ id: "x", pricePence: 500, includesMe: false, contactIds: ["a"] }];
    expect(receiptSplit(onlyA, 550, "me")).toEqual([
      { contactId: null, sharePence: 50 },
      { contactId: "a", sharePence: 500 },
    ]);
  });
  it("refuses to split while a line has no owner", () => {
    const orphan: ReceiptLine[] = [{ id: "x", pricePence: 1, includesMe: false, contactIds: [] }];
    expect(unassignedLines(orphan)).toEqual(["x"]);
    expect(() => receiptSplit(orphan, 1, "me")).toThrow();
  });
});
