"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FileIcon, ImageIcon, ReceiptIcon, Spinner, TrashIcon } from "@/components/icons";
import { PreviewList } from "@/components/import/PreviewList";
import { CATEGORIES, CATEGORY_LABEL, type Category } from "@/lib/categories";
import { confirmReceiptDraft, confirmStatementDraft, findReceiptMatches, saveDraftResult, type ReceiptMatch } from "@/lib/data/drafts";
import { existingDedupeKeys } from "@/lib/data/import";
import { dedupeKey } from "@/lib/dedupe";
import { formatCnDate } from "@/lib/dates";
import {
  effectiveStatus,
  type DraftRow,
  type ReceiptDraftResult,
  type StatementDraftResult,
} from "@/lib/import/drafts";
import type { PreviewRow } from "@/lib/import/preview";
import { formatPence, parsePounds } from "@/lib/money";
import { createBrowserSupabase } from "@/lib/supabase/browser";

const KIND_LABEL = { statement: "银行截图", csv: "CSV 文件", receipt: "小票" } as const;

/** Writes `value` back to the draft shortly after it stops changing (and once more on leaving). */
function useAutosave(draftId: string, value: unknown, enabled: boolean) {
  const sb = createBrowserSupabase();
  const latest = useRef(value);
  const dirty = useRef(false);
  const first = useRef(true);
  latest.current = value;

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!enabled) return;
    dirty.current = true;
    const t = setTimeout(() => {
      dirty.current = false;
      saveDraftResult(sb, draftId, latest.current).catch(() => (dirty.current = true));
    }, 700);
    return () => clearTimeout(t);
  }, [value, enabled, draftId, sb]);

  useEffect(
    () => () => {
      if (dirty.current) void saveDraftResult(sb, draftId, latest.current);
    },
    [draftId, sb],
  );
}

export function DraftCard({
  draft,
  onRetry,
  onDelete,
  onConfirmed,
}: {
  draft: DraftRow;
  onRetry: (draft: DraftRow) => void;
  onDelete: (draft: DraftRow) => Promise<void>;
  onConfirmed: (text: string) => void;
}) {
  const status = effectiveStatus(draft);
  const Icon = draft.kind === "receipt" ? ReceiptIcon : draft.kind === "csv" ? FileIcon : ImageIcon;
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!armed) {
      setArmed(true);
      setTimeout(() => setArmed(false), 3000);
      return;
    }
    setBusy(true);
    try {
      await onDelete(draft);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="card flex flex-col gap-3 p-4">
      <div className="flex items-center gap-3">
        <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${status === "error" ? "bg-danger/10 text-danger" : "bg-accent-soft text-accent"}`}>
          {status === "working" ? <Spinner /> : <Icon size={20} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{KIND_LABEL[draft.kind]}{draft.file_name ? ` · ${draft.file_name}` : ""}</p>
          <p className={`text-xs ${status === "error" ? "text-danger" : "text-muted"}`}>
            {status === "working" && "识别中，可以先去别的页面，结果会一直保留"}
            {status === "error" && (draft.error && draft.status === "error" ? draft.error : "识别超时了，点「重试」再来一次")}
            {status === "done" && "识别完成，确认后才会入账"}
          </p>
        </div>
        <button
          className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm ${armed ? "bg-danger text-white" : "text-muted"}`}
          disabled={busy}
          onClick={remove}
          aria-label="删除这份识别结果"
        >
          <TrashIcon size={16} />
          {armed ? "再点一次删除" : ""}
        </button>
      </div>

      {status === "error" && (
        <div className="flex gap-2">
          {draft.image_path ? (
            <>
              <button className="btn flex-1 py-2 text-sm" onClick={() => onRetry(draft)}>重试（用上面选的 AI 源）</button>
            </>
          ) : (
            <p className="text-sm text-muted">这份文件没法重试，删除后重新上传一次。</p>
          )}
        </div>
      )}

      {status === "done" && draft.kind === "receipt" && <ReceiptBody draft={draft} onRetry={onRetry} onConfirmed={onConfirmed} />}
      {status === "done" && draft.kind !== "receipt" && <StatementBody draft={draft} onRetry={onRetry} onConfirmed={onConfirmed} />}
    </li>
  );
}

function StatementBody({
  draft,
  onRetry,
  onConfirmed,
}: {
  draft: DraftRow;
  onRetry: (d: DraftRow) => void;
  onConfirmed: (t: string) => void;
}) {
  const sb = createBrowserSupabase();
  const [rows, setRows] = useState<PreviewRow[]>(() => (draft.result as StatementDraftResult | null)?.rows ?? []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const snapshot = useMemo<StatementDraftResult>(() => ({ rows }), [rows]);
  useAutosave(draft.id, snapshot, true);

  const included = rows.filter((r) => r.include).length;

  async function confirm() {
    setBusy(true);
    setMessage(null);
    try {
      const chosen = rows.filter((r) => r.include);
      const known = await existingDedupeKeys(sb, chosen.map(dedupeKey));
      const dupes = chosen.filter((r) => known.has(dedupeKey(r)));
      if (dupes.length > 0) {
        setRows((rs) => rs.map((r) => (dupes.includes(r) ? { ...r, duplicate: true, include: false } : r)));
        setMessage(`有 ${dupes.length} 笔和已经入账的账单重复，已帮你取消勾选，再确认一下`);
        return;
      }
      const n = await confirmStatementDraft(sb, draft, rows);
      onConfirmed(`已导入 ${n} 笔，去「待处理」逐笔确认`);
    } catch (e) {
      setMessage(`保存失败：${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between text-sm">
        <button className="font-semibold" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {rows.length} 笔交易 <span className="text-muted">{open ? "收起 ▴" : "展开 ▾"}</span>
        </button>
        {draft.image_path && (
          <button className="text-accent" onClick={() => onRetry(draft)}>重新识别</button>
        )}
      </div>
      {open && <PreviewList rows={rows} onChange={setRows} />}
      {message && <p className="rounded-xl bg-later/10 p-3 text-sm text-later" role="alert">{message}</p>}
      <button className="btn btn-primary" disabled={busy || included === 0} onClick={confirm}>
        {busy ? "处理中…" : included === 0 ? "没有勾选的交易" : `导入 ${included} 笔`}
      </button>
    </div>
  );
}

function ReceiptBody({
  draft,
  onRetry,
  onConfirmed,
}: {
  draft: DraftRow;
  onRetry: (d: DraftRow) => void;
  onConfirmed: (t: string) => void;
}) {
  const sb = createBrowserSupabase();
  const [r, setR] = useState<ReceiptDraftResult>(() => draft.result as ReceiptDraftResult);
  const [matches, setMatches] = useState<ReceiptMatch[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useAutosave(draft.id, r, true);

  useEffect(() => {
    let live = true;
    findReceiptMatches(sb, r)
      .then((m) => live && setMatches(m))
      .catch(() => live && setMatches([]));
    return () => {
      live = false;
    };
  }, [sb, r.date, r.totalPence]); // eslint-disable-line react-hooks/exhaustive-deps

  const itemsTotal = r.items.reduce((s, i) => s + i.pricePence, 0);
  const patchItem = (n: number, p: Partial<ReceiptDraftResult["items"][number]>) =>
    setR((x) => ({ ...x, items: x.items.map((it, i) => (i === n ? { ...it, ...p } : it)) }));

  async function confirm(attachTo?: string) {
    setBusy(true);
    setMessage(null);
    try {
      await confirmReceiptDraft(sb, draft, r, attachTo);
      onConfirmed(attachTo ? "小票明细已并入那笔账单，去「待处理」分账" : `「${r.merchant}」已入账，去「待处理」选是否和人分、怎么分`);
    } catch (e) {
      setMessage(`保存失败：${(e as Error).message}`);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <input className="field font-semibold" value={r.merchant} onChange={(e) => setR({ ...r, merchant: e.target.value })} aria-label="商家" />
        <input
          key={r.totalPence}
          className="field num w-28 text-right"
          inputMode="decimal"
          defaultValue={(r.totalPence / 100).toFixed(2)}
          aria-label="总花费"
          onBlur={(e) => {
            const v = parsePounds(e.target.value);
            if (v === null || v <= 0) e.target.value = (r.totalPence / 100).toFixed(2);
            else setR({ ...r, totalPence: v });
          }}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input className="field num" type="date" value={r.date} onChange={(e) => e.target.value && setR({ ...r, date: e.target.value })} aria-label="日期" />
        <select className="field" value={r.category} onChange={(e) => setR({ ...r, category: e.target.value as Category })} aria-label="分类">
          {CATEGORIES.filter((c) => c !== "transfer").map((c) => (
            <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
          ))}
        </select>
      </div>

      <ul className="flex flex-col divide-y divide-line rounded-xl border border-line">
        {r.items.map((it, n) => (
          <li key={n} className="grid grid-cols-[1fr_84px_auto] items-center gap-2 px-3 py-2">
            <input className="min-w-0 bg-transparent py-1 outline-none" value={it.name} onChange={(e) => patchItem(n, { name: e.target.value })} aria-label="商品名" />
            <input
              key={it.pricePence}
              className="num bg-transparent py-1 text-right outline-none"
              inputMode="decimal"
              defaultValue={(it.pricePence / 100).toFixed(2)}
              aria-label="价格"
              onBlur={(e) => {
                const v = parsePounds(e.target.value);
                if (v === null) e.target.value = (it.pricePence / 100).toFixed(2);
                else patchItem(n, { pricePence: v });
              }}
            />
            <button className="px-1 text-muted" aria-label={`删除 ${it.name}`} onClick={() => setR((x) => ({ ...x, items: x.items.filter((_, i) => i !== n) }))}>
              <TrashIcon size={15} />
            </button>
          </li>
        ))}
        <li>
          <button className="w-full py-2 text-sm text-muted" onClick={() => setR((x) => ({ ...x, items: [...x.items, { name: "", pricePence: 0 }] }))}>
            + 加一行
          </button>
        </li>
      </ul>

      <p className="num text-xs text-muted">
        商品合计 {formatPence(itemsTotal)}，总花费 {formatPence(r.totalPence)}
        {itemsTotal !== r.totalPence && `（差 ${formatPence(r.totalPence - itemsTotal)}，多半是服务费或小费，分账时会一起摊）`}
        {" · "}
        {formatCnDate(r.date)}
      </p>

      {matches.length > 0 && (
        <div className="rounded-xl bg-later/10 p-3 text-sm">
          <p className="font-semibold text-later">可能已经有这一笔了</p>
          <ul className="mt-2 flex flex-col gap-2">
            {matches.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">{m.merchant} · {formatCnDate(m.occurred_on)} · {formatPence(m.amount_pence)}</span>
                <button className="btn shrink-0 px-3 py-1.5 text-sm" disabled={busy} onClick={() => confirm(m.id)}>并入这笔</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {message && <p className="rounded-xl bg-danger/10 p-3 text-sm text-danger" role="alert">{message}</p>}
      <div className="flex items-center gap-3">
        <button className="btn btn-primary flex-1" disabled={busy || r.items.length === 0 || r.totalPence <= 0} onClick={() => confirm()}>
          {busy ? "处理中…" : "入账 " + formatPence(r.totalPence)}
        </button>
        {draft.image_path && (
          <button className="text-sm text-accent" disabled={busy} onClick={() => onRetry(draft)}>重新识别</button>
        )}
      </div>
    </div>
  );
}
