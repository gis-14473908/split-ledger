export const CATEGORIES = [
  "groceries",
  "dining",
  "transport",
  "shopping",
  "bills",
  "entertainment",
  "health",
  "transfer",
  "other",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABEL: Record<Category, string> = {
  groceries: "超市",
  dining: "餐饮外卖",
  transport: "交通",
  shopping: "购物",
  bills: "房租水电",
  entertainment: "娱乐",
  health: "医疗",
  transfer: "转账",
  other: "其他",
};

export const CATEGORY_COLOR: Record<Category, string> = {
  groceries: "#1E8A5A",
  dining: "#D2553A",
  transport: "#2346D8",
  shopping: "#B7791F",
  bills: "#5B6677",
  entertainment: "#8B4FD6",
  health: "#C2416B",
  transfer: "#8A94A6",
  other: "#6B7A5A",
};

export function isCategory(x: unknown): x is Category {
  return typeof x === "string" && (CATEGORIES as readonly string[]).includes(x);
}
