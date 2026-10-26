import { expect, it } from "vitest";
import { safeNext } from "@/lib/nav/safe-next";

it("keeps same-site paths", () => {
  expect(safeNext("/invite/abc?x=1")).toBe("/invite/abc?x=1");
});

it("refuses other origins and empty values", () => {
  expect(safeNext("https://evil.example")).toBe("/");
  expect(safeNext("//evil.example")).toBe("/");
  expect(safeNext("/\\evil.example")).toBe("/");
  expect(safeNext(null)).toBe("/");
});
