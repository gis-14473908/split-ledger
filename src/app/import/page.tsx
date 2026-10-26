"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { PreviewList, type PreviewRow } from "@/components/import/PreviewList";
import type { ModelKey } from "@/lib/ai/models";
import type { ImportedTransaction } from "@/lib/ai/schemas";
import { CSV_UNSUPPORTED_MESSAGE, parseCsv } from "@/lib/csv/registry";
import { existingDedupeKeys, saveImport, uploadImage } from "@/lib/data/import";
import { dedupeKey, markDuplicates } from "@/lib/dedupe";
import { compressImage, ImageDecodeError } from "@/lib/image/compress";
import { createBrowserSupabase } from "@/lib/supabase/browser";

type FileJob = { id: string; name: string; status: "waiting" | "working" | "done" | "error"; error?: string; path?: string; file: File };

const NOTHING_FOUND = "没识别出交易，换一张更清楚的截图，或用 Opus 5.5 重试";

async function recognise(path: string, model?: ModelKey) {
  const res = await fetch("/api/ai/statement", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ imagePath: path, model }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? "识别失败");
  return body as { model: ModelKey; transactions: ImportedTransaction[] };
}

export default function ImportPage() {
  const sb = createBrowserSupabase();
  const [userId, setUserId] = useState<string | null>(null);
  const [jobs, setJobs] = useState<FileJob[]>([]);
  const [found, setFound] = useState<Record<string, ImportedTransaction[]>>({});
  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  const [model, setModel] = useState<ModelKey>("sonnet");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const csvInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    sb.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, [sb]);

  const patchJob = (id: string, patch: Partial<FileJob>) =>
    setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...patch } : j)));

  async function runJob(job: FileJob, override?: ModelKey): Promise<ImportedTransaction[] | null> {
    patchJob(job.id, { status: "working", error: undefined });
    try {
      const path = job.path ?? (await uploadImage(sb, userId!, await compressImage(job.file), "statement"));
      patchJob(job.id, { path });
      job.path = path;
      const r = await recognise(path, override);
      setModel(r.model);
      patchJob(job.id, { status: "done" });
      return r.transactions;
    } catch (e) {
      patchJob(job.id, { status: "error", error: e instanceof ImageDecodeError ? e.message : (e as Error).message });
      return null;
    }
  }

  async function buildPreview(all: Record<string, ImportedTransaction[]>) {
    const list = Object.values(all).flat();
    if (list.length === 0) {
      setRows(null);
      setMessage(NOTHING_FOUND);
      return;
    }
    const existing = await existingDedupeKeys(sb, list.map(dedupeKey));
    setRows(
      markDuplicates(list, existing).map((t, i) => ({ ...t, key: `${i}-${dedupeKey(t)}`, include: !t.duplicate })),
    );
    setMessage(null);
  }

  async function processJobs(list: FileJob[], override?: ModelKey) {
    setBusy(true);
    setMessage(null);
    const next: Record<string, ImportedTransaction[]> = override ? {} : { ...found };
    for (const job of list) {
      const txs = await runJob(job, override);
      if (txs) next[job.id] = txs;
    }
    setFound(next);
    await buildPreview(next);
    setBusy(false);
  }

  async function onPickImages(files: FileList | null) {
    if (!files?.length || !userId) return;
    const added = [...files].map((file) => ({ id: crypto.randomUUID(), name: file.name, status: "waiting" as const, file }));
    setJobs((js) => [...js, ...added]);
    setSaved(null);
    await processJobs(added);
  }

  async function onPickCsv(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    const result = parseCsv(await file.text());
    if (!result.ok) {
      setMessage(result.error === "empty" ? "这个文件是空的" : CSV_UNSUPPORTED_MESSAGE);
      return;
    }
    const txs = result.transactions.map((t) => ({
      ...t,
      status: t.isTransfer || t.amountPence < 0 ? ("transfer" as const) : ("pending" as const),
    }));
    const next = { ...found, [crypto.randomUUID()]: txs };
    setFound(next);
    await buildPreview(next);
  }

  async function save() {
    if (!rows) return;
    const chosen = rows.filter((r) => r.include);
    setBusy(true);
    try {
      const n = await saveImport(sb, chosen, {
        kind: "screenshot",
        filePaths: jobs.flatMap((j) => (j.path ? [j.path] : [])),
        model,
      });
      setSaved(n);
      setRows(null);
      setJobs([]);
      setFound({});
    } catch (e) {
      setMessage(`保存失败：${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const done = jobs.filter((j) => j.status === "done" || j.status === "error").length;
  const working = jobs.find((j) => j.status === "working");
  const included = rows?.filter((r) => r.include).length ?? 0;

  return (
    <main className="mx-auto flex max-w-[480px] flex-col gap-5 px-4 pt-6">
      <h1 className="font-display text-2xl font-extrabold">导入账单</h1>

      {saved !== null && (
        <div className="card flex flex-col gap-3 p-4">
          <p>已导入 {saved} 笔。</p>
          <Link href="/review" className="btn btn-primary">去逐笔确认</Link>
        </div>
      )}

      <section className="grid grid-cols-2 gap-3">
        <button className="card flex flex-col items-start gap-1 p-4 text-left" onClick={() => imageInput.current?.click()} disabled={busy || !userId}>
          <span className="font-bold">上传截图</span>
          <span className="text-xs text-muted">银行 App 的交易列表，可多选</span>
        </button>
        <button className="card flex flex-col items-start gap-1 p-4 text-left" onClick={() => csvInput.current?.click()} disabled={busy}>
          <span className="font-bold">上传 CSV</span>
          <span className="text-xs text-muted">银行导出的账单文件</span>
        </button>
        <input ref={imageInput} id="pick-images" type="file" accept="image/*" multiple hidden onChange={(e) => { onPickImages(e.target.files); e.target.value = ""; }} />
        <input ref={csvInput} id="pick-csv" type="file" accept=".csv,text/csv" hidden onChange={(e) => { onPickCsv(e.target.files); e.target.value = ""; }} />
      </section>

      {jobs.length > 0 && (
        <section className="flex flex-col gap-2" aria-live="polite">
          {busy && working && (
            <p className="text-sm text-muted">正在识别第 {Math.min(done + 1, jobs.length)}/{jobs.length} 张…</p>
          )}
          <ul className="flex flex-col gap-1 text-sm">
            {jobs.map((j) => (
              <li key={j.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{j.name}</span>
                {j.status === "working" && <span className="text-muted">识别中</span>}
                {j.status === "done" && <span className="text-ok">完成</span>}
                {j.status === "error" && (
                  <>
                    <span className="text-danger">{j.error}</span>
                    <button className="text-accent" disabled={busy} onClick={() => processJobs([j])}>重试</button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {message && <p className="card p-4 text-sm" role="alert">{message}</p>}

      {rows && (
        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h2 className="font-bold">识别结果（{rows.length} 笔）</h2>
            <button
              className="text-sm text-accent"
              disabled={busy || jobs.every((j) => !j.path)}
              onClick={() => processJobs(jobs.filter((j) => j.path), "opus")}
            >
              用 Opus 5.5 重新识别
            </button>
          </div>
          <PreviewList rows={rows} onChange={setRows} />
          <button className="btn btn-primary sticky bottom-20" disabled={busy || included === 0} onClick={save}>
            {busy ? "处理中…" : `导入 ${included} 笔`}
          </button>
        </section>
      )}
    </main>
  );
}
