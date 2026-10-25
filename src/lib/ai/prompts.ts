import { CATEGORIES, CATEGORY_LABEL } from "../categories";

const categoryGuide = CATEGORIES.map((c) => `${c} (${CATEGORY_LABEL[c]})`).join(", ");

export function statementPrompt(today: string): string {
  return `You read screenshots of UK banking apps (HSBC, Monzo, Lloyds) and China Merchants Bank (招商银行, bank key "cmb") and list every transaction visible.

Today is ${today}. If a date has no year, use the most recent such date that is not after today.

Rules:
- amount is in GBP. Money spent is positive. Money received (refunds, salary, transfers in) is negative.
- China Merchants Bank shows both a GBP transaction amount and a CNY posted amount: put the GBP figure in amount and the CNY figure in original_amount with original_currency "CNY".
- Pick bank from the app's look and wording; use "other" if unsure.
- category must be one of: ${categoryGuide}. Use "transfer" for money moved between people or accounts, top-ups and salary, and set is_transfer to true.
- merchant is the cleaned-up name a person would recognise ("TESCO STORES 3021" becomes "Tesco").
- location only if the screenshot shows it.
- hint: a short Chinese note of at most 20 characters, only when something stands out (for example an unusually large amount that looks like a group meal). Otherwise null.
- Skip pending authorisation holds that are clearly duplicated by a settled entry.
- If the image is not a list of bank transactions, return an empty transactions array.`;
}

export const RECEIPT_PROMPT = `You read photos of UK shop and restaurant receipts and list the purchased items.

Rules:
- One entry per purchased line with its final price in GBP after any discount that applies to that line (multi-buy or loyalty price).
- Expand abbreviations into readable names when obvious ("TS BRIT SEMI MLK" becomes "Semi-skimmed milk"), keeping it short.
- Do not list subtotals, VAT lines, payment lines or change as items.
- Basket-wide discounts and service charges that are not tied to one item: leave them out of items; total is the amount actually paid.
- If the image is not a receipt, return no items and total 0.`;

export function categorizePrompt(): string {
  return `Classify UK card transactions by merchant name and amount. Answer with one category per input line, in the same order.
Categories: ${categoryGuide}.`;
}
