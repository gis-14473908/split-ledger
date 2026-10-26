import { expect, it } from "vitest";
import { mergePreview } from "@/lib/import/preview";
import { tx } from "./fixtures";

const row = (o: Parameters<typeof tx>[0], extra = {}) => ({ ...tx(o), status: "pending" as const, ...extra });

it("keeps the user's edits when another screenshot is added", () => {
  const first = mergePreview([], [row({ merchantRaw: "A" }), row({ merchantRaw: "B" })], new Set());
  const edited = first
    .filter((r) => r.merchantRaw !== "B") // deleted
    .map((r) => ({ ...r, amountPence: 999, include: false })); // edited and unticked
  const merged = mergePreview(edited, [row({ merchantRaw: "C" })], new Set());
  expect(merged.map((r) => [r.merchantRaw, r.amountPence, r.include])).toEqual([
    ["A", 999, false],
    ["C", 2345, true],
  ]);
});

it("flags new rows that repeat the database or rows already in the preview", () => {
  const first = mergePreview([], [row({ merchantRaw: "A" })], new Set());
  const merged = mergePreview(first, [row({ merchantRaw: "A" }), row({ merchantRaw: "D", amountPence: 5 })], new Set(["2026-10-22|5|d"]));
  expect(merged.slice(1).map((r) => [r.merchantRaw, r.duplicate, r.include])).toEqual([
    ["A", true, false],
    ["D", true, false],
  ]);
});

it("gives every row a unique key", () => {
  const merged = mergePreview(mergePreview([], [row({})], new Set()), [row({})], new Set());
  expect(new Set(merged.map((r) => r.key)).size).toBe(2);
});
