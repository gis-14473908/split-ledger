/** One person's part of a transaction. contactId null means "me". */
export type Share = { contactId: string | null; sharePence: number };

/**
 * Split a total evenly. Any leftover pence go to me, or to the first
 * participant when I am not part of the split, so shares always add up.
 */
export function equalSplit(totalPence: number, participants: (string | null)[]): Share[] {
  if (participants.length === 0) throw new Error("equalSplit: no participants");
  if (new Set(participants).size !== participants.length) throw new Error("equalSplit: duplicate participant");

  const base = Math.trunc(totalPence / participants.length);
  const remainder = totalPence - base * participants.length;
  const remainderTo = participants.includes(null) ? null : participants[0];

  return participants.map((contactId) => ({
    contactId,
    sharePence: base + (contactId === remainderTo ? remainder : 0),
  }));
}
