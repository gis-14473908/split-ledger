import { expect, it } from "vitest";
import { parseCsv, type CsvParser } from "@/lib/csv/registry";
import { tx } from "./fixtures";

it("reports an empty file", () => {
  expect(parseCsv("")).toEqual({ ok: false, error: "empty" });
});

it("reports formats no parser recognises", () => {
  expect(parseCsv("Date,Amount\n2026-10-01,1.00")).toEqual({ ok: false, error: "unsupported" });
});

it("hands the raw rows to the first parser that recognises them", () => {
  const fake: CsvParser = {
    bank: "monzo",
    detect: (rows) => rows[0].includes("Emoji"),
    parse: (rows) => rows.slice(1).map((r) => tx({ merchantRaw: r[0] })),
  };
  const r = parseCsv("Name,Emoji\nPret,x", [fake]);
  expect(r.ok && r.bank).toBe("monzo");
  expect(r.ok && r.transactions[0].merchantRaw).toBe("Pret");
});
