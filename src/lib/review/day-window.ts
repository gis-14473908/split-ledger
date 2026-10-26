import type { DayEntry } from "../data/review";

/**
 * The slice of a day's spending shown on a review card: at most `size` rows,
 * always including the current transaction and roughly centred on it.
 */
export function dayWindow(entries: DayEntry[], size: number) {
  if (entries.length <= size) return { rows: entries, hiddenBefore: 0, hiddenAfter: 0 };
  const current = Math.max(0, entries.findIndex((e) => e.isCurrent));
  const start = Math.min(Math.max(0, current - Math.floor((size - 1) / 2)), entries.length - size);
  return {
    rows: entries.slice(start, start + size),
    hiddenBefore: start,
    hiddenAfter: entries.length - start - size,
  };
}
