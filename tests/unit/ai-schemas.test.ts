import { expect, it } from "vitest";
import { StatementResult, toParsedTransactions } from "@/lib/ai/schemas";

const sample = {
  bank: "cmb",
  transactions: [
    {
      date: "2026-10-22", time: "19:42", merchant_raw: "TESCO STORES 3021", merchant: "Tesco Express",
      location: "Oxford Rd, Manchester", amount: 23.45, original_amount: null, original_currency: null,
      category: "groceries", is_transfer: false, hint: null,
    },
    {
      date: "2026-10-21", time: null, merchant_raw: "REFUND AMAZON", merchant: "Amazon",
      location: null, amount: -50, original_amount: null, original_currency: null,
      category: "shopping", is_transfer: false, hint: null,
    },
    {
      date: "2026-10-20", time: "18:05", merchant_raw: "SAINSBURYS", merchant: "Sainsbury's",
      location: null, amount: 31.2, original_amount: 297.4, original_currency: "CNY",
      category: "groceries", is_transfer: false, hint: "金额偏大",
    },
  ],
};

it("maps a statement into pending transactions in pence", () => {
  const rows = toParsedTransactions(StatementResult.parse(sample));
  expect(rows[0]).toMatchObject({
    occurredOn: "2026-10-22", occurredTime: "19:42", merchantRaw: "TESCO STORES 3021", merchant: "Tesco Express",
    amountPence: 2345, category: "groceries", bank: "cmb", status: "pending", isTransfer: false,
  });
});

it("routes refunds and income out of the split queue", () => {
  const rows = toParsedTransactions(StatementResult.parse(sample));
  expect(rows[1]).toMatchObject({ amountPence: -5000, status: "transfer", category: "transfer" });
});

it("keeps the original currency amount", () => {
  const rows = toParsedTransactions(StatementResult.parse(sample));
  expect(rows[2]).toMatchObject({ amountPence: 3120, originalAmount: 297.4, originalCurrency: "CNY", hint: "金额偏大" });
});

it("rejects dates that are not ISO", () => {
  const bad = { ...sample, transactions: [{ ...sample.transactions[0], date: "22/10" }] };
  expect(StatementResult.safeParse(bad).success).toBe(false);
});
