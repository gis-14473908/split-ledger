import { describe, expect, it } from "vitest";
import { formatPence, parsePounds, poundsToPence } from "@/lib/money";

describe("formatPence", () => {
  it("formats pence as pounds", () => {
    expect(formatPence(1234)).toBe("£12.34");
    expect(formatPence(5)).toBe("£0.05");
  });
  it("puts the sign before the pound symbol", () => {
    expect(formatPence(-120)).toBe("-£1.20");
  });
  it("groups thousands", () => {
    expect(formatPence(123456)).toBe("£1,234.56");
  });
});

describe("parsePounds", () => {
  it("parses plain and formatted amounts into pence", () => {
    expect(parsePounds("12.3")).toBe(1230);
    expect(parsePounds("£1,234.50")).toBe(123450);
  });
  it("returns null for input that is not an amount", () => {
    expect(parsePounds("abc")).toBeNull();
    expect(parsePounds("")).toBeNull();
  });
});

describe("poundsToPence", () => {
  it("removes floating point error", () => {
    expect(poundsToPence(0.1 + 0.2)).toBe(30);
  });
});
