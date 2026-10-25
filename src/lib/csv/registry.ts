import Papa from "papaparse";
import type { Bank } from "../banks";
import type { ParsedTransaction } from "../import/types";

/**
 * A bank-specific CSV reader. Add one per bank once a real (redacted) export is available,
 * register it in CSV_PARSERS, and add the sample as a test fixture.
 */
export interface CsvParser {
  bank: Bank;
  detect(headers: string[]): boolean;
  parse(rows: Record<string, string>[]): ParsedTransaction[];
}

export const CSV_PARSERS: CsvParser[] = [];

export const CSV_UNSUPPORTED_MESSAGE = "暂不支持这个格式，请先用截图导入";

export type CsvResult =
  | { ok: true; bank: Bank; transactions: ParsedTransaction[] }
  | { ok: false; error: "empty" | "unsupported" };

export function parseCsv(text: string, parsers: CsvParser[] = CSV_PARSERS): CsvResult {
  if (!text.trim()) return { ok: false, error: "empty" };
  const { data, meta } = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  const headers = meta.fields ?? [];
  const parser = parsers.find((p) => p.detect(headers));
  if (!parser) return { ok: false, error: "unsupported" };
  return { ok: true, bank: parser.bank, transactions: parser.parse(data) };
}
