import type { Category } from "../categories";
import type { ParsedTransaction } from "./types";

export type CategorizeFn = (items: { merchant: string; amountPence: number }[]) => Promise<Category[]>;

/**
 * Give every uncategorised row (CSV exports carry no category) a category with one AI call.
 * If the call fails, those rows become "other" and the import carries on.
 */
export async function fillCategories<T extends ParsedTransaction>(rows: T[], categorize: CategorizeFn) {
  const missing = rows.flatMap((r, i) => (r.category === null ? [i] : []));
  if (missing.length === 0) return { rows, failed: false };
  try {
    const cats = await categorize(missing.map((i) => ({ merchant: rows[i].merchant, amountPence: rows[i].amountPence })));
    const out = [...rows];
    missing.forEach((rowIndex, k) => (out[rowIndex] = { ...out[rowIndex], category: cats[k] ?? "other" }));
    return { rows: out, failed: false };
  } catch {
    return { rows: rows.map((r) => (r.category === null ? { ...r, category: "other" as Category } : r)), failed: true };
  }
}
