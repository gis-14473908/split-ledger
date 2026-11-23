import type { SupabaseClient } from "@supabase/supabase-js";
import type { Transaction } from "../db/types";
import { dedupeKey } from "../dedupe";
import type { DraftKind, DraftRow, ReceiptDraftResult, StatementDraftResult } from "../import/drafts";
import type { PreviewRow } from "../import/preview";
import { addDays } from "../dates";
import { saveImport } from "./import";
import { saveReceipt } from "./receipt";

export async function listDrafts(sb: SupabaseClient): Promise<DraftRow[]> {
  const { data, error } = await sb.from("import_drafts").select("*").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as DraftRow[];
}

export async function createDraft(
  sb: SupabaseClient,
  d: { kind: DraftKind; fileName: string; imagePath?: string; status?: "working" | "done"; result?: unknown },
): Promise<string> {
  const { data, error } = await sb
    .from("import_drafts")
    .insert({
      kind: d.kind,
      file_name: d.fileName,
      image_path: d.imagePath ?? null,
      status: d.status ?? "working",
      result: d.result ?? null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "保存草稿失败");
  return data.id as string;
}

/** Ask the server to recognise a draft's image. Returns at once; the result lands on the draft. */
export async function startDraft(sb: SupabaseClient, draftId: string, source?: string): Promise<void> {
  let message: string | null = null;
  try {
    const res = await fetch("/api/ai/draft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draftId, source }),
    });
    if (!res.ok) message = ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "识别没有启动，请重试";
  } catch {
    message = "网络不太稳，识别没有启动，请重试";
  }
  if (message) await sb.from("import_drafts").update({ status: "error", error: message }).eq("id", draftId);
}

export async function finishDraft(sb: SupabaseClient, draftId: string, patch: { status: "done" | "error"; result?: unknown; error?: string }) {
  const { error } = await sb.from("import_drafts").update(patch).eq("id", draftId);
  if (error) throw new Error(error.message);
}

export async function saveDraftResult(sb: SupabaseClient, draftId: string, result: unknown): Promise<void> {
  const { error } = await sb.from("import_drafts").update({ result }).eq("id", draftId);
  if (error) throw new Error(error.message);
}

/** Delete a draft. Its image goes too, since nothing else points at it yet. */
export async function deleteDraft(sb: SupabaseClient, draft: Pick<DraftRow, "id" | "image_path">): Promise<void> {
  const { error } = await sb.from("import_drafts").delete().eq("id", draft.id);
  if (error) throw new Error(error.message);
  if (draft.image_path) await sb.storage.from("uploads").remove([draft.image_path]);
}

async function dropDraftRow(sb: SupabaseClient, id: string) {
  const { error } = await sb.from("import_drafts").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Turn a confirmed statement or CSV draft into pending transactions, then remove the draft. */
export async function confirmStatementDraft(sb: SupabaseClient, draft: DraftRow, rows: PreviewRow[]): Promise<number> {
  const chosen = rows.filter((r) => r.include);
  const n = await saveImport(sb, chosen, {
    kind: draft.kind === "csv" ? "csv" : "screenshot",
    filePaths: draft.image_path ? [draft.image_path] : [],
    sourceLabel: draft.model_used ?? "",
  });
  await dropDraftRow(sb, draft.id);
  return n;
}

export type ReceiptMatch = Pick<Transaction, "id" | "merchant" | "occurred_on" | "amount_pence" | "status">;

/** Open bills that look like the same purchase (same amount, within two days). */
export async function findReceiptMatches(sb: SupabaseClient, r: Pick<ReceiptDraftResult, "date" | "totalPence">): Promise<ReceiptMatch[]> {
  const { data, error } = await sb
    .from("transactions")
    .select("id, merchant, occurred_on, amount_pence, status")
    .eq("amount_pence", r.totalPence)
    .in("status", ["pending", "later"])
    .gte("occurred_on", addDays(r.date, -2))
    .lte("occurred_on", addDays(r.date, 2));
  if (error) throw new Error(error.message);
  return (data ?? []) as ReceiptMatch[];
}

/**
 * Turn a confirmed receipt draft into a pending bill with its items attached (nobody assigned
 * yet; that happens in the review screen), or attach the items to an existing bill.
 */
export async function confirmReceiptDraft(
  sb: SupabaseClient,
  draft: DraftRow,
  r: ReceiptDraftResult,
  attachTo?: string,
): Promise<string> {
  if (!draft.image_path) throw new Error("小票图片丢失了，请删除后重新上传");
  let txId = attachTo;
  let created = false;
  if (!txId) {
    const { data, error } = await sb
      .from("transactions")
      .insert({
        occurred_on: r.date,
        merchant_raw: r.merchant,
        merchant: r.merchant,
        amount_pence: r.totalPence,
        category: r.category,
        bank: "other",
        source: "screenshot",
        status: "pending",
        dedupe_key: dedupeKey({ occurredOn: r.date, amountPence: r.totalPence, merchantRaw: r.merchant }),
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message ?? "保存失败");
    txId = data.id as string;
    created = true;
  }
  try {
    const lines = r.items.map((i, n) => ({ id: `i${n}`, pricePence: i.pricePence, includesMe: false, contactIds: [] as string[] }));
    await saveReceipt(sb, txId, {
      imagePath: draft.image_path,
      totalPence: r.items.reduce((s, i) => s + i.pricePence, 0),
      sourceLabel: draft.model_used ?? "",
      lines,
      names: Object.fromEntries(r.items.map((i, n) => [`i${n}`, i.name])),
    });
  } catch (e) {
    if (created) await sb.from("transactions").delete().eq("id", txId);
    throw e;
  }
  await dropDraftRow(sb, draft.id);
  return txId;
}

export type { ReceiptDraftResult, StatementDraftResult };
