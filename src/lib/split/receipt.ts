import { equalSplit, type Share } from "./equal";

export type ReceiptLine = { id: string; pricePence: number; includesMe: boolean; contactIds: string[] };

/** How to handle a gap between the receipt total and what the bank charged. */
export type Reconcile = "proportional" | "me";

export function unassignedLines(lines: ReceiptLine[]): string[] {
  return lines.filter((l) => !l.includesMe && l.contactIds.length === 0).map((l) => l.id);
}

export function receiptSplit(lines: ReceiptLine[], totalPence: number, reconcile: Reconcile): Share[] {
  if (unassignedLines(lines).length > 0) throw new Error("receiptSplit: every line needs an owner");

  // Subtotal per person, keyed by contact id ("" stands for me), in first-seen order with me first.
  const subtotals = new Map<string, number>();
  const add = (key: string, pence: number) => subtotals.set(key, (subtotals.get(key) ?? 0) + pence);
  if (lines.some((l) => l.includesMe)) subtotals.set("", 0);
  for (const line of lines) {
    const owners = [...(line.includesMe ? [null] : []), ...line.contactIds];
    for (const s of equalSplit(line.pricePence, owners)) add(s.contactId ?? "", s.sharePence);
  }

  const itemsTotal = [...subtotals.values()].reduce((a, b) => a + b, 0);
  const diff = totalPence - itemsTotal;

  if (reconcile === "me" || itemsTotal === 0) {
    if (diff !== 0 || !subtotals.has("")) {
      const withMe = new Map([["", 0], ...subtotals]);
      withMe.set("", withMe.get("")! + diff);
      return toShares(withMe);
    }
    return toShares(subtotals);
  }

  // Largest remainder: truncate each proportional part, then hand out the leftover pence
  // one at a time to whoever lost the biggest fraction.
  const keys = [...subtotals.keys()];
  const exact = keys.map((k) => (diff * subtotals.get(k)!) / itemsTotal);
  const parts = exact.map(Math.trunc);
  let leftover = diff - parts.reduce((a, b) => a + b, 0);
  const step = Math.sign(leftover);
  const byFraction = keys
    .map((_, i) => i)
    .sort((a, b) => Math.abs(exact[b] - parts[b]) - Math.abs(exact[a] - parts[a]));
  for (let i = 0; leftover !== 0; i++, leftover -= step) parts[byFraction[i % keys.length]] += step;

  keys.forEach((k, i) => subtotals.set(k, subtotals.get(k)! + parts[i]));
  return toShares(subtotals);
}

function toShares(m: Map<string, number>): Share[] {
  return [...m].map(([k, sharePence]) => ({ contactId: k === "" ? null : k, sharePence }));
}
