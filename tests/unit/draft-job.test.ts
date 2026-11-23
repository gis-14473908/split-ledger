import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/run", () => ({ runStructured: vi.fn() }));

import { runDraftJob } from "@/lib/ai/draft-job";
import { AI_ERROR_MESSAGE } from "@/lib/ai/errors";
import { runStructured, type ResolvedSource } from "@/lib/ai/run";
import { recordingSupabase } from "./fake-supabase";

const SOURCE: ResolvedSource = { kind: "builtin", apiFormat: "anthropic", model: "m", apiKey: "k", label: "Sonnet 5.5", allowServerFallback: true };
const USAGE = { inputTokens: 10, outputTokens: 5 };
const answer = (parsed: unknown) => vi.mocked(runStructured).mockResolvedValue({ parsed, usage: USAGE } as never);

function sbWithImage() {
  const sb = recordingSupabase();
  return {
    ...sb,
    storage: { from: () => ({ download: async () => ({ data: new Blob([new Uint8Array([1])], { type: "image/jpeg" }), error: null }) }) },
  };
}
const patchOf = (sb: ReturnType<typeof recordingSupabase>) => sb.calls.filter((c) => c.op === "update").at(-1)!.args[0] as Record<string, unknown>;

beforeEach(() => vi.mocked(runStructured).mockReset());

describe("runDraftJob", () => {
  it("stores a recognised receipt on the draft and reports usage", async () => {
    answer({ merchant: "Nando's", date: "2026-11-20", category: "dining", total: 24.5, items: [{ name: "Wings", price: 9.5 }, { name: "Wrap", price: 15 }] });
    const sb = sbWithImage();
    const onUsage = vi.fn();
    await runDraftJob(sb as never, { id: "d1", kind: "receipt", image_path: "u/receipt/x.jpg" }, SOURCE, onUsage);
    expect(onUsage).toHaveBeenCalledWith(USAGE);
    expect(patchOf(sb as never)).toMatchObject({
      status: "done",
      model_used: "Sonnet 5.5",
      result: { merchant: "Nando's", date: "2026-11-20", category: "dining", totalPence: 2450, items: [{ name: "Wings", pricePence: 950 }, { name: "Wrap", pricePence: 1500 }] },
    });
  });

  it("falls back to today and the item total when the receipt omits them", async () => {
    answer({ merchant: null, date: null, category: "other", total: 0, items: [{ name: "A", price: 2 }] });
    const sb = sbWithImage();
    await runDraftJob(sb as never, { id: "d1", kind: "receipt", image_path: "p" }, SOURCE);
    const r = patchOf(sb as never).result as { merchant: string; date: string; totalPence: number };
    expect(r.totalPence).toBe(200);
    expect(r.merchant).toBe("小票");
    expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("marks the draft failed when nothing is recognised", async () => {
    answer({ merchant: null, date: null, category: "other", total: 0, items: [] });
    const sb = sbWithImage();
    await runDraftJob(sb as never, { id: "d1", kind: "receipt", image_path: "p" }, SOURCE);
    expect(patchOf(sb as never)).toMatchObject({ status: "error" });
  });

  it("stores a recognised statement with duplicate flags", async () => {
    answer({
      bank: "monzo",
      transactions: [{ date: "2026-10-22", time: null, merchant_raw: "TESCO", merchant: "Tesco", location: null, amount: 23.45, original_amount: null, original_currency: null, category: "groceries", is_transfer: false, hint: null }],
    });
    const sb = sbWithImage();
    await runDraftJob(sb as never, { id: "d1", kind: "statement", image_path: "p" }, SOURCE);
    const patch = patchOf(sb as never);
    expect(patch.status).toBe("done");
    const rows = (patch.result as { rows: { merchant: string; include: boolean }[] }).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ merchant: "Tesco", include: true });
  });

  it("stores a readable message when the answer is unusable", async () => {
    answer({
      bank: "monzo",
      transactions: [{ date: "yesterday", time: null, merchant_raw: "X", merchant: "X", location: null, amount: 1, original_amount: null, original_currency: null, category: "other", is_transfer: false, hint: null }],
    });
    const sb = sbWithImage();
    await runDraftJob(sb as never, { id: "d1", kind: "statement", image_path: "p" }, SOURCE);
    expect(patchOf(sb as never)).toMatchObject({ status: "error", error: AI_ERROR_MESSAGE.invalid_output });
  });
});
