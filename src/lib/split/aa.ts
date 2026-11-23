import { equalSplit, type Share } from "./equal";
import { receiptSplit, type ReceiptLine, type Reconcile } from "./receipt";

/**
 * AA: the group already paid the restaurant in equal parts, so only the gap between what each
 * person ate and their equal part is owed.
 *  - each:     everyone paid their own part by card. The bill shrinks to my part.
 *  - paid_all: I paid it all and friends already sent me their equal parts.
 */
export type AaMode = "each" | "paid_all";

export type AaPlan = {
  /** Shares to store on the bill. In "each" mode a friend's share can be negative (I owe them). */
  shares: Share[];
  /** What each friend already paid; becomes a settlement in "paid_all" mode. */
  paid: Share[];
  /** The bill's amount after saving. */
  amountPence: number;
};

export function aaPlan(a: {
  lines: ReceiptLine[];
  mode: AaMode;
  /** The whole receipt (what the group paid together). */
  receiptTotalPence: number;
  /** The bill's amount now, before any AA reduction. */
  billAmountPence: number;
  contactIds: string[];
  reconcile: Reconcile;
}): AaPlan {
  const people: (string | null)[] = [null, ...a.contactIds];
  const total = a.mode === "each" ? a.receiptTotalPence : a.billAmountPence;
  const equalPart = new Map(equalSplit(total, people).map((s) => [s.contactId, s.sharePence]));

  const ate = new Map(receiptSplit(a.lines, total, a.reconcile).map((s) => [s.contactId, s.sharePence]));
  const had = (id: string | null) => ate.get(id) ?? 0;

  if (a.mode === "paid_all") {
    return {
      shares: people.map((id) => ({ contactId: id, sharePence: had(id) })),
      paid: a.contactIds.map((id) => ({ contactId: id, sharePence: equalPart.get(id)! })).filter((p) => p.sharePence > 0),
      amountPence: a.billAmountPence,
    };
  }

  const mine = equalPart.get(null)!;
  const friends = a.contactIds.map((id) => ({ contactId: id, sharePence: had(id) - equalPart.get(id)! }));
  const owedToMe = friends.reduce((s, f) => s + f.sharePence, 0);
  return { shares: [{ contactId: null, sharePence: mine - owedToMe }, ...friends], paid: [], amountPence: mine };
}
