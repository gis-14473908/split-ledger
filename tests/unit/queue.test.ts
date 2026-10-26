import { expect, it } from "vitest";
import { decide, initQueue, jump, undo } from "@/lib/review/queue";

it("moves to the next card after a decision", () => {
  const s = decide(initQueue(["a", "b", "c"]), "a", "personal");
  expect(s.order).toEqual(["b", "c"]);
  expect(s.currentId).toBe("b");
});

it("sends 'later' to the back and stops once only 'later' cards remain", () => {
  let s = decide(initQueue(["a", "b", "c"]), "a", "personal");
  s = decide(s, "b", "later");
  expect(s.order).toEqual(["c", "b"]);
  s = decide(s, "c", "shared");
  s = decide(s, "b", "later");
  expect(s.order).toEqual([]);
  expect(s.currentId).toBeNull();
});

it("undo restores the last card as current", () => {
  let s = decide(initQueue(["a", "b", "c"]), "a", "personal");
  s = decide(s, "b", "later");
  s = decide(s, "c", "shared");
  s = decide(s, "b", "later");
  const u = undo(s);
  expect(u.undone).toEqual({ id: "b", choice: "later" });
  expect(u.state.currentId).toBe("b");
  expect(u.state.decided.b).toBeUndefined();
});

it("undo with no history does nothing", () => {
  const s = initQueue(["a"]);
  expect(undo(s)).toEqual({ state: s, undone: null });
});

it("jumps to a pending card", () => {
  expect(jump(initQueue(["a", "b"]), "b").currentId).toBe("b");
});

it("jumping to a decided card puts it back in the queue undecided", () => {
  let t = decide(initQueue(["a", "b"]), "a", "personal");
  t = jump(t, "a");
  expect(t.order).toContain("a");
  expect(t.currentId).toBe("a");
  expect(t.decided.a).toBeUndefined();
});
