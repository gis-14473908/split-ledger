"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { PENDING_CHANGED } from "@/components/BottomNav";
import { FileIcon, ImageIcon, ReceiptIcon, Spinner } from "@/components/icons";
import { DraftCard } from "@/components/import/DraftCard";
import { SourceSelect, useSourcePicker } from "@/components/ai/SourcePicker";
import { CSV_UNSUPPORTED_MESSAGE, parseCsv } from "@/lib/csv/registry";
import { createDraft, deleteDraft, finishDraft, listDrafts, startDraft } from "@/lib/data/drafts";
import { existingDedupeKeys, uploadImage } from "@/lib/data/import";
import { dedupeKey } from "@/lib/dedupe";
import { effectiveStatus, type DraftRow, type StatementDraftResult } from "@/lib/import/drafts";
import { fillCategories } from "@/lib/import/categorize";
import { mergePreview } from "@/lib/import/preview";
import type { Category } from "@/lib/categories";
import { compressImage, ImageDecodeError } from "@/lib/image/compress";
import { createBrowserSupabase } from "@/lib/supabase/browser";

const MAX_IMAGES = 8;

type Uploading = { id: string; name: string; error?: string };

async function categorizeViaApi(items: { merchant: string; amountPence: number }[]): Promise<Category[]> {
  const res = await fetch("/api/ai/categorize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ items }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) throw new Error(body?.error ?? "分类失败");
  return body.categories;
}

export default function ImportPage() {
  const sb = createBrowserSupabase();
  const [userId, setUserId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftRow[] | null>(null);
  const [uploading, setUploading] = useState<Uploading[]>([]);
  const { options, sourceKey, setSourceKey } = useSourcePicker(sb);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const statementInput = useRef<HTMLInputElement>(null);
  const receiptInput = useRef<HTMLInputElement>(null);
  const csvInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setDrafts(await listDrafts(sb));
    } catch (e) {
      setNotice({ text: `加载失败：${(e as Error).message}`, ok: false });
    }
  }, [sb]);

  useEffect(() => {
    sb.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
    void load();
  }, [sb, load]);

  // Recognition runs on the server; keep checking while anything is still working.
  const anyWorking = drafts?.some((d) => effectiveStatus(d) === "working") ?? false;
  useEffect(() => {
    if (!anyWorking) return;
    const t = setInterval(load, 3000);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [anyWorking, load]);

  async function onPickImages(files: FileList | null, kind: "statement" | "receipt") {
    if (!files?.length || !userId) return;
    const picked = [...files];
    const list = picked.slice(0, MAX_IMAGES);
    setNotice(picked.length > MAX_IMAGES ? { text: `一次最多 ${MAX_IMAGES} 张，先处理前 ${MAX_IMAGES} 张`, ok: false } : null);
    const jobs = list.map((f) => ({ id: crypto.randomUUID(), name: f.name }));
    setUploading((u) => [...u, ...jobs]);
    await Promise.all(
      list.map(async (file, i) => {
        try {
          const path = await uploadImage(sb, userId, await compressImage(file), kind);
          const id = await createDraft(sb, { kind, fileName: file.name, imagePath: path });
          await startDraft(sb, id, sourceKey);
          setUploading((u) => u.filter((x) => x.id !== jobs[i].id));
        } catch (e) {
          const text = e instanceof ImageDecodeError ? e.message : `上传失败：${(e as Error).message}`;
          setUploading((u) => u.map((x) => (x.id === jobs[i].id ? { ...x, error: text } : x)));
        }
      }),
    );
    await load();
  }

  async function onPickCsv(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    const parsed = parseCsv(await file.text());
    if (!parsed.ok) {
      setNotice({ text: parsed.error === "empty" ? "这个文件是空的" : CSV_UNSUPPORTED_MESSAGE, ok: false });
      return;
    }
    setNotice(null);
    let draftId: string | null = null;
    try {
      draftId = await createDraft(sb, { kind: "csv", fileName: file.name });
      await load();
      // CSV rows carry no category: one AI call for all of them (merchant names and amounts only).
      const { rows: categorised, failed } = await fillCategories(parsed.transactions, categorizeViaApi);
      const txs = categorised.map((t) => ({
        ...t,
        status: t.isTransfer || t.amountPence < 0 ? ("transfer" as const) : ("pending" as const),
      }));
      const dbKeys = await existingDedupeKeys(sb, txs.map(dedupeKey));
      const result: StatementDraftResult = { rows: mergePreview([], txs, dbKeys) };
      await finishDraft(sb, draftId, { status: "done", result });
      if (failed) setNotice({ text: "自动分类失败了，先都标成「其他」，可以在下面手动改", ok: false });
    } catch (e) {
      if (draftId) await finishDraft(sb, draftId, { status: "error", error: `出错了：${(e as Error).message}` }).catch(() => {});
    }
    await load();
  }

  async function onRetry(draft: DraftRow) {
    setDrafts((ds) => ds?.map((d) => (d.id === draft.id ? { ...d, status: "working", error: null, updated_at: new Date().toISOString() } : d)) ?? null);
    await startDraft(sb, draft.id, sourceKey);
    await load();
  }

  async function onDelete(draft: DraftRow) {
    try {
      await deleteDraft(sb, draft);
      setDrafts((ds) => ds?.filter((d) => d.id !== draft.id) ?? null);
    } catch (e) {
      setNotice({ text: `删除失败：${(e as Error).message}`, ok: false });
    }
  }

  function onConfirmed(draftId: string, text: string) {
    setDrafts((ds) => ds?.filter((d) => d.id !== draftId) ?? null);
    setNotice({ text, ok: true });
    window.dispatchEvent(new Event(PENDING_CHANGED));
  }

  const empty = drafts !== null && drafts.length === 0 && uploading.length === 0;

  return (
    <main className="mx-auto flex max-w-[480px] flex-col gap-5 px-4 pt-6">
      <header>
        <h1 className="font-display text-2xl font-extrabold">导入账单</h1>
        <p className="mt-1 text-sm text-muted">上传后在后台识别，可以随时离开；确认之前结果都会保留。</p>
        <label className="mt-3 flex items-center gap-2 text-sm text-muted">
          识别用
          <SourceSelect options={options} value={sourceKey} onChange={setSourceKey} />
        </label>
      </header>

      <section className="grid grid-cols-3 gap-3">
        <Tile icon={<ImageIcon size={26} />} title="银行截图" hint="可多选" onClick={() => statementInput.current?.click()} disabled={!userId} />
        <Tile icon={<ReceiptIcon size={26} />} title="小票" hint="直接入账" onClick={() => receiptInput.current?.click()} disabled={!userId} />
        <Tile icon={<FileIcon size={26} />} title="CSV" hint="HSBC" onClick={() => csvInput.current?.click()} />
        <input ref={statementInput} id="pick-images" type="file" accept="image/*" multiple hidden onChange={(e) => { void onPickImages(e.target.files, "statement"); e.target.value = ""; }} />
        <input ref={receiptInput} id="pick-receipts" type="file" accept="image/*" multiple hidden onChange={(e) => { void onPickImages(e.target.files, "receipt"); e.target.value = ""; }} />
        <input ref={csvInput} id="pick-csv" type="file" accept=".csv,text/csv" hidden onChange={(e) => { void onPickCsv(e.target.files); e.target.value = ""; }} />
      </section>

      {notice && (
        <div className={`card flex items-center justify-between gap-3 p-4 text-sm ${notice.ok ? "border-ok/40 bg-ok/10" : "border-later/40 bg-later/10"}`} role="status">
          <span>{notice.text}</span>
          {notice.ok && <Link href="/review" className="btn btn-primary shrink-0 px-3 py-2 text-sm">去处理</Link>}
        </div>
      )}

      {uploading.length > 0 && (
        <ul className="flex flex-col gap-2" aria-live="polite">
          {uploading.map((u) => (
            <li key={u.id} className="card flex items-center gap-3 p-3 text-sm">
              {u.error ? <span className="text-danger">!</span> : <Spinner />}
              <span className="min-w-0 flex-1 truncate">{u.name}</span>
              <span className={u.error ? "text-danger" : "text-muted"}>{u.error ?? "上传中…"}</span>
              {u.error && <button className="text-accent" onClick={() => setUploading((x) => x.filter((y) => y.id !== u.id))}>知道了</button>}
            </li>
          ))}
        </ul>
      )}

      {drafts === null && <p className="py-8 text-center text-muted">加载中…</p>}

      {drafts && drafts.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-bold">
            识别结果 <span className="num text-sm font-normal text-muted">{drafts.length}</span>
          </h2>
          <ul className="flex flex-col gap-3">
            {drafts.map((d) => (
              <DraftCard key={d.id} draft={d} onRetry={onRetry} onDelete={onDelete} onConfirmed={(t) => onConfirmed(d.id, t)} />
            ))}
          </ul>
        </section>
      )}

      {empty && (
        <div className="card flex flex-col items-center gap-2 p-8 text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-accent-soft text-accent"><ImageIcon size={28} /></span>
          <p className="font-semibold">还没有待确认的识别结果</p>
          <p className="text-sm text-muted">传银行截图 / CSV 记流水，或者直接拍小票入账。</p>
        </div>
      )}
    </main>
  );
}

function Tile({ icon, title, hint, onClick, disabled }: { icon: React.ReactNode; title: string; hint: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      className="card flex flex-col items-center gap-2 px-2 py-4 text-center shadow-sm transition active:scale-[0.97] disabled:opacity-50"
      onClick={onClick}
      disabled={disabled}
    >
      <span className="grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent">{icon}</span>
      <span className="font-bold">{title}</span>
      <span className="text-xs text-muted">{hint}</span>
    </button>
  );
}
