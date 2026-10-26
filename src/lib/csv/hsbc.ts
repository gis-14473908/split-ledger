import { poundsToPence } from "../money";
import type { ParsedTransaction } from "../import/types";
import type { CsvParser } from "./types";

// HSBC UK "Download" from the transaction list: no header, three columns —
// DD/MM/YYYY, description ending in a payment-type code, signed amount (negative = spent).

const DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const AMOUNT = /^-?[\d,]+(\.\d{1,2})?$/;

// Trailing payment-type codes. TFR/OBP/SO/BGC/CR move money between people or accounts.
const TYPE_CODES = new Set(["VIS", ")))", "DD", "SO", "BP", "OBP", "TFR", "CR", "DR", "BGC", "ATM", "CHQ", "DEB", "FPI", "FPO"]);
const TRANSFER_CODES = new Set(["TFR", "OBP", "SO", "BGC", "CR", "FPI"]);

function typeCode(description: string): string | null {
  const last = description.trim().split(/\s+/).at(-1) ?? "";
  return TYPE_CODES.has(last) ? last : null;
}

/** Turn "INT'L 0058486159 CrocsEU Den Haag VIS" into "CrocsEU Den Haag". */
export function cleanHsbcDescription(description: string): string {
  let words = description.trim().split(/\s+/);
  if (TYPE_CODES.has(words.at(-1) ?? "")) words = words.slice(0, -1);
  if (words[0] === "INT'L") words = words.slice(1);
  let text = words.join(" ");
  // "AMAZON* B007P8R14 LONDON" → "AMAZON": what follows the asterisk is an order reference.
  if (text.includes("*")) text = text.slice(0, text.indexOf("*"));
  // Drop phone numbers, account numbers and payment references.
  words = text.split(/\s+/).filter((w) => w && !/^\d+$/.test(w) && !/\d{4,}/.test(w) && !/^\d[\d-]+$/.test(w));
  text = words.join(" ").trim() || description.trim();
  // ALL CAPS reads badly on a card; mixed case is the merchant's own spelling, keep it.
  if (text === text.toUpperCase()) text = text.toLowerCase().replace(/(^|\s)(\S)/g, (_, s, c) => s + c.toUpperCase());
  return text;
}

export const hsbcParser: CsvParser = {
  bank: "hsbc",
  detect: (rows) =>
    rows.length > 0 && rows.every((r) => r.length === 3 && DATE.test(r[0]) && AMOUNT.test(r[2].replace(/\s/g, ""))),
  parse: (rows) =>
    rows.map(([date, description, amount]): ParsedTransaction => {
      const [, dd, mm, yyyy] = DATE.exec(date)!;
      const signed = poundsToPence(Number(amount.replace(/[,\s]/g, "")));
      const code = typeCode(description);
      const isTransfer = signed > 0 || (code !== null && TRANSFER_CODES.has(code));
      return {
        occurredOn: `${yyyy}-${mm}-${dd}`,
        occurredTime: null,
        merchantRaw: description,
        merchant: cleanHsbcDescription(description),
        location: null,
        amountPence: -signed,
        originalAmount: null,
        originalCurrency: null,
        category: isTransfer ? "transfer" : null,
        isTransfer,
        hint: null,
        bank: "hsbc",
      };
    }),
};
