import { expect, it } from "vitest";
import { formatCnDate, weekdayCn } from "@/lib/dates";
import { historyHint } from "@/lib/hints";

it("formats dates the Chinese way", () => {
  expect(formatCnDate("2026-10-15")).toBe("10月15日");
  expect(weekdayCn("2026-10-22")).toBe("周四");
  expect(weekdayCn("2026-10-18")).toBe("周日");
});

it("prefers what happened last time at the same merchant", () => {
  expect(
    historyHint({ occurredOn: "2026-10-15", amountPence: 1820, status: "shared", contactNames: ["孙豪"] }, null),
  ).toBe("上次在这家：10月15日 £18.20，和孙豪分账");
  expect(
    historyHint({ occurredOn: "2026-10-15", amountPence: 1820, status: "shared", contactNames: ["孙豪", "李明"] }, null),
  ).toBe("上次在这家：10月15日 £18.20，和孙豪、李明分账");
  expect(
    historyHint({ occurredOn: "2026-10-15", amountPence: 1820, status: "personal", contactNames: [] }, "x"),
  ).toBe("上次在这家：10月15日 £18.20，自己的");
});

it("falls back to the AI hint, then to nothing", () => {
  expect(historyHint(null, "可能是聚餐")).toBe("可能是聚餐");
  expect(historyHint(null, null)).toBeNull();
});
