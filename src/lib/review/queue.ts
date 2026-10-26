// State machine for the swipe review deck. Pure, so the page can stay a thin shell.

export type Choice = "personal" | "shared" | "later";

export type QueueState = {
  order: string[]; // cards still to handle, front first
  currentId: string | null;
  decided: Record<string, Choice>;
  history: { id: string; choice: Choice; index: number }[];
};

export function initQueue(ids: string[]): QueueState {
  return { order: [...ids], currentId: ids[0] ?? null, decided: {}, history: [] };
}

export function decide(s: QueueState, id: string, choice: Choice): QueueState {
  const index = s.order.indexOf(id);
  const wasLater = s.decided[id] === "later";
  let order = s.order.filter((x) => x !== id);
  if (choice === "later") order.push(id);
  const decided = { ...s.decided, [id]: choice };

  // Skipping a card that was already put off, when nothing else is left, ends the session
  // instead of cycling through the same "later" cards forever.
  if (choice === "later" && wasLater && order.every((x) => decided[x] === "later")) order = [];

  return { order, currentId: order[0] ?? null, decided, history: [...s.history, { id, choice, index }] };
}

export function undo(s: QueueState): { state: QueueState; undone: { id: string; choice: Choice } | null } {
  const last = s.history.at(-1);
  if (!last) return { state: s, undone: null };

  const decided = { ...s.decided };
  delete decided[last.id];
  const order = s.order.filter((x) => x !== last.id);
  // Bring back "later" cards dropped when the session ended.
  for (const [id, c] of Object.entries(decided)) if (c === "later" && !order.includes(id)) order.push(id);
  order.splice(Math.min(Math.max(last.index, 0), order.length), 0, last.id);

  return {
    state: { order, currentId: last.id, decided, history: s.history.slice(0, -1) },
    undone: { id: last.id, choice: last.choice },
  };
}

export function jump(s: QueueState, id: string): QueueState {
  if (s.order.includes(id) && s.decided[id] !== "later") return { ...s, currentId: id };
  const decided = { ...s.decided };
  delete decided[id];
  return { ...s, order: [id, ...s.order.filter((x) => x !== id)], currentId: id, decided };
}
