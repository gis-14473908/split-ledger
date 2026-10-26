import type { ImportedTransaction } from "../ai/schemas";
import { dedupeKey, markDuplicates } from "../dedupe";

export type PreviewRow = ImportedTransaction & { key: string; duplicate: boolean; include: boolean };

let seq = 0;

/**
 * Append newly recognised rows to the preview without touching rows the user already
 * edited, deleted or unticked. New rows are checked against the database and the preview.
 */
export function mergePreview(existing: PreviewRow[], incoming: ImportedTransaction[], dbKeys: Set<string>): PreviewRow[] {
  const known = new Set([...dbKeys, ...existing.map(dedupeKey)]);
  const added = markDuplicates(incoming, known).map((t) => ({ ...t, key: `r${++seq}`, include: !t.duplicate }));
  return [...existing, ...added];
}
