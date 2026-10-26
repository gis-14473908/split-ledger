import Papa from "papaparse";
import type { Bank } from "../banks";
import type { ParsedTransaction } from "../import/types";
import { hsbcParser } from "./hsbc";
import type { CsvParser } from "./types";

export type { CsvParser };

export const CSV_PARSERS: CsvParser[] = [hsbcParser];

export const CSV_UNSUPPORTED_MESSAGE = "暂不支持这个格式（目前支持 HSBC），请先用截图导入";

export type CsvResult =
  | { ok: true; bank: Bank; transactions: ParsedTransaction[] }
  | { ok: false; error: "empty" | "unsupported" };

export function parseCsv(text: string, parsers: CsvParser[] = CSV_PARSERS): CsvResult {
  if (!text.trim()) return { ok: false, error: "empty" };
  const { data } = Papa.parse<string[]>(text.replace(/^﻿/, ""), { header: false, skipEmptyLines: true });
  const rows = data.map((r) => r.map((c) => c.trim()));
  const parser = parsers.find((p) => p.detect(rows));
  if (!parser) return { ok: false, error: "unsupported" };
  return { ok: true, bank: parser.bank, transactions: parser.parse(rows) };
}
