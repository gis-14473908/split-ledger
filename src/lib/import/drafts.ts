import type { Category } from "../categories";
import type { PreviewRow } from "./preview";

export type DraftKind = "statement" | "csv" | "receipt";
export type DraftStatus = "working" | "done" | "error";

export type ReceiptDraftResult = {
  merchant: string;
  date: string; // YYYY-MM-DD
  category: Category;
  totalPence: number;
  items: { name: string; pricePence: number }[];
};

export type StatementDraftResult = { rows: PreviewRow[] };

export type DraftRow = {
  id: string;
  kind: DraftKind;
  status: DraftStatus;
  file_name: string;
  image_path: string | null;
  model_used: string | null;
  result: unknown;
  error: string | null;
  created_at: string;
  updated_at: string;
};

/** A job that has been "working" this long has almost certainly died with its server function. */
export const STALE_AFTER_MS = 3 * 60 * 1000;
export const STALE_MESSAGE = "识别超时了，点「重试」再来一次";

export const NOTHING_FOUND = "没识别出交易，换一张更清楚的截图，或换一个 AI 源重试";
export const NO_RECEIPT_ITEMS = "没识别出小票内容，换一张更清楚的照片，或换一个 AI 源重试";

export function isStale(d: Pick<DraftRow, "status" | "updated_at">, now = Date.now()): boolean {
  return d.status === "working" && now - new Date(d.updated_at).getTime() > STALE_AFTER_MS;
}

/** What the screen should show: stale jobs count as failed. */
export function effectiveStatus(d: DraftRow, now = Date.now()): DraftStatus {
  return isStale(d, now) ? "error" : d.status;
}
