import { describe, expect, it } from "vitest";
import { confirmReceiptDraft, confirmStatementDraft, createDraft, deleteDraft, findReceiptMatches } from "@/lib/data/drafts";
import { effectiveStatus, isStale, STALE_AFTER_MS, type DraftRow } from "@/lib/import/drafts";
import { recordingSupabase } from "./fake-supabase";
import { tx } from "./fixtures";

const draft = (o: Partial<DraftRow> = {}): DraftRow => ({
  id: "d1", kind: "receipt", status: "done", file_name: "r.jpg", image_path: "u/receipt/r.jpg", model_used: "sonnet",
  result: null, error: null, created_at: "", updated_at: new Date().toISOString(), ...o,
});

describe("draft status", () => {
  it("treats a long-running job as failed", () => {
    const old = new Date(Date.now() - STALE_AFTER_MS - 1000).toISOString();
    expect(isStale({ status: "working", updated_at: old })).toBe(true);
    expect(effectiveStatus(draft({ status: "working", updated_at: old }))).toBe("error");
    expect(effectiveStatus(draft({ status: "working" }))).toBe("working");
    expect(effectiveStatus(draft({ status: "done", updated_at: old }))).toBe("done");
  });
});

describe("drafts data", () => {
  it("creates a draft row", async () => {
    const sb = recordingSupabase({ "import_drafts.single": { data: { id: "d9" }, error: null } });
    expect(await createDraft(sb as never, { kind: "receipt", fileName: "a.jpg", imagePath: "p" })).toBe("d9");
    expect(sb.calls.find((c) => c.op === "insert")?.args[0]).toMatchObject({ kind: "receipt", image_path: "p", status: "working" });
  });

  it("deleting a draft also removes its image", async () => {
    const removed: string[][] = [];
    const sb = { ...recordingSupabase(), storage: { from: () => ({ remove: async (p: string[]) => void removed.push(p) }) } };
    await deleteDraft(sb as never, { id: "d1", image_path: "u/receipt/r.jpg" });
    expect(removed).toEqual([["u/receipt/r.jpg"]]);
  });

  it("confirming a statement draft imports the ticked rows and drops the draft", async () => {
    const sb = recordingSupabase({ "imports.single": { data: { id: "imp" }, error: null } });
    const rows = [
      { ...tx(), status: "pending" as const, key: "1", duplicate: false, include: true },
      { ...tx({ merchantRaw: "OTHER" }), status: "pending" as const, key: "2", duplicate: false, include: false },
    ];
    const n = await confirmStatementDraft(sb as never, draft({ kind: "statement" }), rows);
    expect(n).toBe(1);
    const ops = sb.calls.map((c) => `${c.table}.${c.op}`);
    expect(ops).toContain("transactions.insert");
    expect(ops).toContain("import_drafts.delete");
  });

  it("confirming a receipt creates a pending bill with unassigned items, then drops the draft", async () => {
    const sb = recordingSupabase({
      "transactions.single": { data: { id: "t1" }, error: null },
      "receipts.single": { data: { id: "r1" }, error: null },
    });
    const id = await confirmReceiptDraft(sb as never, draft(), {
      merchant: "Nando's", date: "2026-11-20", category: "dining", totalPence: 4800,
      items: [{ name: "Chicken", pricePence: 1200 }, { name: "Wrap", pricePence: 1000 }],
    });
    expect(id).toBe("t1");
    const inserts = sb.calls.filter((c) => c.op === "insert");
    expect(inserts[0]).toMatchObject({ table: "transactions" });
    expect(inserts[0].args[0]).toMatchObject({ amount_pence: 4800, status: "pending", merchant: "Nando's", occurred_on: "2026-11-20" });
    const items = inserts.find((c) => c.table === "receipt_items")!.args[0] as Record<string, unknown>[];
    expect(items.map((i) => [i.name, i.price_pence, i.includes_me, i.contact_ids])).toEqual([
      ["Chicken", 1200, false, []],
      ["Wrap", 1000, false, []],
    ]);
    expect(sb.calls.some((c) => c.table === "import_drafts" && c.op === "delete")).toBe(true);
  });

  it("attaching to an existing bill does not create another one", async () => {
    const sb = recordingSupabase({ "receipts.single": { data: { id: "r1" }, error: null } });
    const id = await confirmReceiptDraft(
      sb as never,
      draft(),
      { merchant: "X", date: "2026-11-20", category: "dining", totalPence: 500, items: [{ name: "A", pricePence: 500 }] },
      "existing-tx",
    );
    expect(id).toBe("existing-tx");
    expect(sb.calls.some((c) => c.table === "transactions" && c.op === "insert")).toBe(false);
  });

  it("looks for open bills with the same amount near the receipt date", async () => {
    const sb = recordingSupabase({ transactions: { data: [{ id: "t9" }], error: null } });
    const m = await findReceiptMatches(sb as never, { date: "2026-11-20", totalPence: 4800 });
    expect(m).toEqual([{ id: "t9" }]);
    const calls = sb.calls.map((c) => [c.op, ...c.args]);
    expect(calls).toContainEqual(["eq", "amount_pence", 4800]);
    expect(calls).toContainEqual(["gte", "occurred_on", "2026-11-18"]);
    expect(calls).toContainEqual(["lte", "occurred_on", "2026-11-22"]);
  });
});
