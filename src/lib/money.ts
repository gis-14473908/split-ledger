// All money is stored as integer pence; these helpers convert at the edges.

const grouping = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatPence(pence: number): string {
  const sign = pence < 0 ? "-" : "";
  return `${sign}£${grouping.format(Math.abs(pence) / 100)}`;
}

export function poundsToPence(x: number): number {
  return Math.round(x * 100);
}

export function parsePounds(input: string): number | null {
  const cleaned = input.replace(/[£,\s]/g, "");
  if (!/^-?\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  return poundsToPence(Number(cleaned));
}
