import { expect, it } from "vitest";
import { parseCsv, type CsvParser } from "@/lib/csv/registry";
import { tx } from "./fixtures";

it("reports an empty file", () => {
  expect(parseCsv("")).toEqual({ ok: false, error: "empty" });
});

it("reports unsupported formats while no parser is registered", () => {
  expect(parseCsv("Date,Amount\n2026-10-01,1.00")).toEqual({ ok: false, error: "unsupported" });
});

it("hands rows to the first parser that recognises the headers", () => {
  const fake: CsvParser = {
    bank: "monzo",
    detect: (h) => h.includes("Emoji"),
    parse: (rows) => rows.map((r) => tx({ merchantRaw: r.Name })),
  };
  const r = parseCsv("Name,Emoji\nPret,x", [fake]);
  expect(r.ok && r.bank).toBe("monzo");
  expect(r.ok && r.transactions[0].merchantRaw).toBe("Pret");
});
