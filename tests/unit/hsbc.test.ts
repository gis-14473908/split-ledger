import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cleanHsbcDescription, hsbcParser } from "@/lib/csv/hsbc";
import { parseCsv } from "@/lib/csv/registry";

// Real HSBC UK export (account number and name redacted). No header row: date, description, amount.
const sample = readFileSync(new URL("../fixtures/hsbc.csv", import.meta.url), "utf8");

describe("HSBC CSV", () => {
  const r = parseCsv(sample);
  const rows = r.ok ? r.transactions : [];

  it("is recognised and every row is read", () => {
    expect(r.ok && r.bank).toBe("hsbc");
    expect(rows).toHaveLength(19);
  });

  it("turns spending into positive pence with an ISO date", () => {
    expect(rows[0]).toMatchObject({
      occurredOn: "2026-10-26",
      occurredTime: null,
      merchantRaw: "AIRBNB * HMWPNFXRX 400-022-1666 VIS",
      merchant: "Airbnb",
      amountPence: 79000,
      isTransfer: false,
      category: null,
      bank: "hsbc",
    });
  });

  it("marks transfers and payments to people as transfers", () => {
    const transfer = rows.find((t) => t.merchantRaw.endsWith(" TFR"))!;
    expect(transfer).toMatchObject({ merchant: "Internet Transfer", amountPence: 58225, isTransfer: true, category: "transfer" });
    const payment = rows.find((t) => t.merchantRaw.endsWith(" OBP"))!;
    expect(payment).toMatchObject({ merchant: "A Friend", isTransfer: true, category: "transfer" });
  });

  it("keeps direct debits as spending", () => {
    expect(rows.find((t) => t.merchantRaw.endsWith(" DD"))).toMatchObject({ amountPence: 957, isTransfer: false });
  });
});

describe("cleanHsbcDescription", () => {
  it("drops the payment type, reference numbers and the INT'L prefix", () => {
    expect(cleanHsbcDescription("TESCO STORES GREATER MANCH )))")).toBe("Tesco Stores Greater Manch");
    expect(cleanHsbcDescription("INT'L 0058486159 CrocsEU Den Haag VIS")).toBe("CrocsEU Den Haag");
    expect(cleanHsbcDescription("AMAZON* B007P8R14 LONDON VIS")).toBe("Amazon");
    expect(cleanHsbcDescription("Amazon Prime*B25CW amzn.co.uk/pm VIS")).toBe("Amazon Prime");
    expect(cleanHsbcDescription("BEENETWORK.COM/CHA 0161 244 1000 )))")).toBe("Beenetwork.com/cha");
    expect(cleanHsbcDescription("Go Ape Fornham St Ma VIS")).toBe("Go Ape Fornham St Ma");
  });
});

describe("hsbcParser", () => {
  it("treats money coming in as a transfer with a negative amount", () => {
    const [t] = hsbcParser.parse([["01/10/2026", "STUDENT LOAN CO BGC", "1,250.00"]]);
    expect(t).toMatchObject({ amountPence: -125000, isTransfer: true, category: "transfer", occurredOn: "2026-10-01" });
  });

  it("does not claim files with a header row", () => {
    expect(hsbcParser.detect([["Date", "Description", "Amount"], ["01/10/2026", "X VIS", "-1.00"]])).toBe(false);
  });
});
