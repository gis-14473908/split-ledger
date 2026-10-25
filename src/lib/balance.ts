export type BalanceInput = {
  /** Shares assigned to my contacts in transactions I paid for. */
  owedToMe: { contactId: string; sharePence: number }[];
  /** Shares assigned to me in a linked contact's own ledger, mapped to my contact for them. */
  owedByMe: { contactId: string; sharePence: number }[];
  /** Positive: they paid me. Negative: I paid them. */
  settlements: { contactId: string; amountPence: number }[];
};

/** Net balance per contact. Positive means the contact owes me. */
export function computeBalances(input: BalanceInput): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (id: string, pence: number) => (out[id] = (out[id] ?? 0) + pence);
  for (const s of input.owedToMe) add(s.contactId, s.sharePence);
  for (const s of input.owedByMe) add(s.contactId, -s.sharePence);
  for (const s of input.settlements) add(s.contactId, -s.amountPence);
  return out;
}
