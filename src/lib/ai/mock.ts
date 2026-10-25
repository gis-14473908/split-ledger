// Fixed answers used when AI_MOCK=1 (local development and end-to-end tests).

const today = () => new Date().toISOString().slice(0, 10);

export const MOCKS = {
  statement: () => ({
    bank: "monzo",
    transactions: [
      {
        date: today(), time: "12:31", merchant_raw: "PRET A MANGER", merchant: "Pret A Manger", location: "Oxford Rd, Manchester",
        amount: 6.8, original_amount: null, original_currency: null, category: "dining", is_transfer: false, hint: null,
      },
      {
        date: today(), time: "19:42", merchant_raw: "TESCO STORES 3021", merchant: "Tesco Express", location: "Oxford Rd, Manchester",
        amount: 23.45, original_amount: null, original_currency: null, category: "groceries", is_transfer: false, hint: null,
      },
      {
        date: today(), time: "21:10", merchant_raw: "NANDOS OXFORD RD", merchant: "Nando's", location: "Oxford Rd, Manchester",
        amount: 48.6, original_amount: null, original_currency: null, category: "dining", is_transfer: false, hint: "金额偏大，可能是聚餐",
      },
    ],
  }),
  receipt: () => ({
    merchant: "Tesco Express",
    items: [
      { name: "Semi-skimmed milk", price: 1.45 },
      { name: "Sourdough bread", price: 2.0 },
      { name: "Beer 4 pack", price: 5.5 },
      { name: "Chicken breast", price: 4.0 },
    ],
    total: 12.95,
  }),
  categorize: (n: number) => ({ categories: Array.from({ length: n }, () => "other") }),
};
