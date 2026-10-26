import * as z from "zod";
import { BANKS } from "../banks";
import { CATEGORIES } from "../categories";
import type { ParsedTransaction } from "../import/types";
import { poundsToPence } from "../money";

// The *Output schemas are what the model is asked to produce (kept to plain JSON Schema
// features). The *Result schemas add the format checks we enforce afterwards.

const StatementRow = z.object({
  date: z.string().describe("Transaction date as YYYY-MM-DD"),
  time: z.string().nullable().describe("24h time as HH:MM, or null if not shown"),
  merchant_raw: z.string().describe("Merchant text exactly as shown"),
  merchant: z.string().describe("Cleaned-up merchant name a person would recognise"),
  location: z.string().nullable(),
  amount: z.number().describe("GBP amount. Money spent is positive; income or refunds are negative"),
  original_amount: z.number().nullable().describe("Amount in another currency if shown (e.g. CNY posted amount)"),
  original_currency: z.string().nullable(),
  category: z.enum(CATEGORIES),
  is_transfer: z.boolean().describe("True for transfers between people/accounts, top-ups, salary"),
  hint: z.string().nullable().describe("Short Chinese hint (max 20 chars) only when something is unusual"),
});

export const StatementOutput = z.object({ bank: z.enum(BANKS), transactions: z.array(StatementRow) });

export const StatementResult = StatementOutput.extend({
  transactions: z.array(
    StatementRow.extend({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      time: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
    }),
  ),
});
export type StatementResult = z.infer<typeof StatementResult>;

export const ReceiptOutput = z.object({
  merchant: z.string().nullable(),
  items: z.array(z.object({ name: z.string(), price: z.number().describe("Line price in GBP after any line discount") })),
  total: z.number().describe("Total paid in GBP"),
});
export type ReceiptResult = z.infer<typeof ReceiptOutput>;

export const CategorizeOutput = z.object({ categories: z.array(z.enum(CATEGORIES)) });
export type CategorizeResult = z.infer<typeof CategorizeOutput>;

export type ImportedTransaction = ParsedTransaction & { status: "pending" | "transfer" };

export function toParsedTransactions(r: StatementResult): ImportedTransaction[] {
  return r.transactions.map((t) => {
    const amountPence = poundsToPence(t.amount);
    const transfer = t.is_transfer || t.category === "transfer" || amountPence < 0;
    return {
      occurredOn: t.date,
      occurredTime: t.time,
      merchantRaw: t.merchant_raw,
      merchant: t.merchant,
      location: t.location,
      amountPence,
      originalAmount: t.original_amount,
      originalCurrency: t.original_currency,
      category: transfer ? "transfer" : t.category,
      isTransfer: transfer,
      hint: t.hint,
      bank: r.bank,
      status: transfer ? "transfer" : "pending",
    };
  });
}
