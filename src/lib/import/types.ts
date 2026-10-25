import type { Bank } from "../banks";
import type { Category } from "../categories";

/** One transaction as read from a screenshot or CSV, before it is saved. */
export type ParsedTransaction = {
  occurredOn: string; // YYYY-MM-DD
  occurredTime: string | null; // HH:MM
  merchantRaw: string;
  merchant: string;
  location: string | null;
  /** Positive is money spent; negative is income or a refund. */
  amountPence: number;
  /** For example the CNY amount China Merchants Bank posts alongside the GBP spend. */
  originalAmount: number | null;
  originalCurrency: string | null;
  category: Category | null;
  isTransfer: boolean;
  hint: string | null;
  bank: Bank;
};
