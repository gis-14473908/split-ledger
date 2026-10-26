import { expect, it } from "vitest";
import { dayWindow } from "@/lib/review/day-window";

const day = (n: number, current: number) =>
  Array.from({ length: n }, (_, i) => ({ time: `${String(8 + i).padStart(2, "0")}:00`, merchant: `M${i}`, amountPence: 100, isCurrent: i === current }));

it("shows everything when it fits", () => {
  const w = dayWindow(day(5, 4), 6);
  expect(w.rows.map((r) => r.merchant)).toEqual(["M0", "M1", "M2", "M3", "M4"]);
  expect([w.hiddenBefore, w.hiddenAfter]).toEqual([0, 0]);
});

it("always keeps the current entry, even late in a busy day", () => {
  const w = dayWindow(day(10, 9), 6);
  expect(w.rows.some((r) => r.isCurrent)).toBe(true);
  expect(w.rows).toHaveLength(6);
  expect([w.hiddenBefore, w.hiddenAfter]).toEqual([4, 0]);
});

it("centres the window on the current entry", () => {
  const w = dayWindow(day(12, 6), 6);
  expect(w.rows.map((r) => r.merchant)).toEqual(["M4", "M5", "M6", "M7", "M8", "M9"]);
  expect([w.hiddenBefore, w.hiddenAfter]).toEqual([4, 2]);
});

it("starts at the top when the current entry is early", () => {
  const w = dayWindow(day(9, 0), 6);
  expect(w.rows[0].merchant).toBe("M0");
  expect([w.hiddenBefore, w.hiddenAfter]).toEqual([0, 3]);
});
