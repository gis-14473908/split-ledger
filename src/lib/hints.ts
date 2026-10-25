import { formatCnDate } from "./dates";
import { formatPence } from "./money";

export type PastDecision = {
  occurredOn: string;
  amountPence: number;
  status: "personal" | "shared";
  contactNames: string[];
};

/** The line on a review card that helps the user remember the transaction. */
export function historyHint(past: PastDecision | null, aiHint: string | null): string | null {
  if (past) {
    const how = past.status === "shared" ? `和${past.contactNames.join("、")}分账` : "自己的";
    return `上次在这家：${formatCnDate(past.occurredOn)} ${formatPence(past.amountPence)}，${how}`;
  }
  return aiHint;
}
