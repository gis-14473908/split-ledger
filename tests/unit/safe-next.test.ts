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

it("refuses paths the URL parser would turn into another origin", () => {
  for (const evil of ["/\t/evil.example", "/\n/evil.example", "/\r\\evil.example", "/%09/evil.example".replace("%09", "\t")]) {
    expect(safeNext(evil)).toBe("/");
    expect(new URL(safeNext(evil), "https://app.test").origin).toBe("https://app.test");
  }
});
