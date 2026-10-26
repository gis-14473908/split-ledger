import type { Bank } from "../banks";
import type { ParsedTransaction } from "../import/types";

/**
 * A bank-specific CSV reader. Rows arrive as raw cells (no header handling), because
 * some banks (HSBC) export without a header row. Add one per bank from a real, redacted
 * export kept in tests/fixtures.
 */
export interface CsvParser {
  bank: Bank;
  detect(rows: string[][]): boolean;
  parse(rows: string[][]): ParsedTransaction[];
}
