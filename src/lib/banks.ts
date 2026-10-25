export const BANKS = ["hsbc", "monzo", "lloyds", "cmb", "other"] as const;

export type Bank = (typeof BANKS)[number];

export const BANK_LABEL: Record<Bank, string> = {
  hsbc: "HSBC",
  monzo: "Monzo",
  lloyds: "Lloyds",
  cmb: "招商银行",
  other: "其他",
};
