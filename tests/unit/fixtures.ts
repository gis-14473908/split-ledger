import type { ParsedTransaction } from "@/lib/import/types";

export const tx = (o: Partial<ParsedTransaction> = {}): ParsedTransaction => ({
  occurredOn: "2026-10-22",
  occurredTime: null,
  merchantRaw: "TESCO 3021",
  merchant: "Tesco",
  location: null,
  amountPence: 2345,
  originalAmount: null,
  originalCurrency: null,
  category: "groceries",
  isTransfer: false,
  hint: null,
  bank: "monzo",
  ...o,
});
