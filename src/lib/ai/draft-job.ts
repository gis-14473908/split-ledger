import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dedupeKey, markDuplicates } from "../dedupe";
import { existingDedupeKeys } from "../data/import";
import { NO_RECEIPT_ITEMS, NOTHING_FOUND, type ReceiptDraftResult, type StatementDraftResult } from "../import/drafts";
import { poundsToPence } from "../money";
import { AI_ERROR_MESSAGE, AiError } from "./errors";
import { RECEIPT_PROMPT, statementPrompt } from "./prompts";
import { downloadImage } from "./route-helpers";
import { runStructured, type ResolvedSource } from "./run";
import { ReceiptOutput, StatementOutput, StatementResult, toParsedTransactions } from "./schemas";

const today = () => new Date().toISOString().slice(0, 10);

async function finish(sb: SupabaseClient, id: string, patch: Record<string, unknown>) {
  const { error } = await sb.from("import_drafts").update(patch).eq("id", id);
  if (error) console.error("draft update failed", error.message);
}

/**
 * Recognise the image behind one draft and write the outcome back to its row, so the result
 * is there whenever the user comes back. Never throws: failures are stored on the draft.
 */
export async function runDraftJob(
  sb: SupabaseClient,
  draft: { id: string; kind: string; image_path: string },
  source: ResolvedSource,
  onUsage?: (usage: { inputTokens: number; outputTokens: number }) => Promise<void> | void,
): Promise<void> {
  try {
    const image = await downloadImage(sb, draft.image_path);

    if (draft.kind === "receipt") {
      const { parsed: r, usage } = await runStructured({
        source,
        system: RECEIPT_PROMPT,
        content: [image, { type: "text", text: "列出这张小票上的所有商品，并给出商家、日期和总额。" }],
        schema: ReceiptOutput,
        mockKey: "receipt",
      });
      await onUsage?.(usage);
      if (r.items.length === 0) {
        return finish(sb, draft.id, { status: "error", error: NO_RECEIPT_ITEMS, model_used: source.label });
      }
      const items = r.items.map((i) => ({ name: i.name, pricePence: poundsToPence(i.price) }));
      const itemsTotal = items.reduce((s, i) => s + i.pricePence, 0);
      const result: ReceiptDraftResult = {
        merchant: r.merchant?.trim() || "小票",
        date: r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : today(),
        category: r.category === "transfer" ? "other" : r.category,
        totalPence: r.total > 0 ? poundsToPence(r.total) : itemsTotal,
        items,
      };
      return finish(sb, draft.id, { status: "done", error: null, model_used: source.label, result });
    }

    const { parsed: raw, usage } = await runStructured({
      source,
      system: statementPrompt(today()),
      content: [image, { type: "text", text: "列出这张截图里的所有交易。" }],
      schema: StatementOutput,
      mockKey: "statement",
    });
    await onUsage?.(usage);
    const checked = StatementResult.safeParse(raw);
    if (!checked.success) throw new AiError("invalid_output");
    const txs = toParsedTransactions(checked.data);
    if (txs.length === 0) return finish(sb, draft.id, { status: "error", error: NOTHING_FOUND, model_used: source.label });

    const dbKeys = await existingDedupeKeys(sb, txs.map(dedupeKey));
    const rows = markDuplicates(txs, dbKeys).map((t) => ({ ...t, key: crypto.randomUUID(), include: !t.duplicate }));
    const result: StatementDraftResult = { rows };
    await finish(sb, draft.id, { status: "done", error: null, model_used: source.label, result });
  } catch (e) {
    if (!(e instanceof AiError)) console.error("draft job failed", e);
    const message = e instanceof AiError ? AI_ERROR_MESSAGE[e.code] : AI_ERROR_MESSAGE.upstream;
    await finish(sb, draft.id, { status: "error", error: message });
  }
}
