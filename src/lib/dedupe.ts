import type { ParsedTransaction } from "./import/types";

/** Lowercase, drop digits and punctuation (store numbers, card refs), keep CJK, collapse spaces. */
export function normalizeMerchant(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function dedupeKey(t: { occurredOn: string; amountPence: number; merchantRaw: string }): string {
  return `${t.occurredOn}|${t.amountPence}|${normalizeMerchant(t.merchantRaw)}`;
}

export function markDuplicates<T extends ParsedTransaction>(
  batch: T[],
  existingKeys: Set<string>,
): (T & { duplicate: boolean })[] {
  const seen = new Set(existingKeys);
  return batch.map((t) => {
    const key = dedupeKey(t);
    const duplicate = seen.has(key);
    seen.add(key);
    return { ...t, duplicate };
  });
}
