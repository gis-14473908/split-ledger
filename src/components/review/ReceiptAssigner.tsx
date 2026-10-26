"use client";

import { useRef, useState } from "react";
import type { ModelKey } from "@/lib/ai/models";
import { uploadImage } from "@/lib/data/import";
import { saveReceipt } from "@/lib/data/receipt";
import type { Contact } from "@/lib/db/types";
import { compressImage, ImageDecodeError } from "@/lib/image/compress";
import { formatPence, parsePounds } from "@/lib/money";
import type { Share } from "@/lib/split/equal";
import { receiptSplit, unassignedLines, type ReceiptLine, type Reconcile } from "@/lib/split/receipt";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import type { SplitTarget } from "./SplitSheet";

type Line = ReceiptLine & { name: string };

type Recognised = { model: ModelKey; merchant: string | null; items: { name: string; pricePence: number }[]; totalPence: number };

async function recognise(imagePath: string, model?: ModelKey): Promise<Recognised> {
  const res = await fetch("/api/ai/receipt", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ imagePath, model }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? "识别失败");
  return body;
}

/** Full-screen step after "按小票分": photo → items → tap who had what → shares. */
export function ReceiptAssigner({
  target,
  people,
  contacts,
  onCancel,
  onDone,
}: {
  target: SplitTarget;
  people: { includeMe: boolean; contactIds: string[] };
  contacts: Contact[];
  onCancel: () => void;
  onDone: (shares: Share[]) => Promise<void>;
}) {
  const sb = createBrowserSupabase();
  const input = useRef<HTMLInputElement>(null);
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [model, setModel] = useState<ModelKey>("sonnet");
  const [lines, setLines] = useState<Line[] | null>(null);
  const [reconcile, setReconcile] = useState<Reconcile>("proportional");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const owners = [
    ...(people.includeMe ? [{ id: null as string | null, name: "我" }] : []),
    ...people.contactIds.map((id) => ({ id, name: contacts.find((c) => c.id === id)?.name ?? "?" })),
  ];

  async function run(path: string, override?: ModelKey) {
    setBusy("正在识别小票…");
    setError(null);
    try {
      const r = await recognise(path, override);
      setModel(r.model);
      if (r.items.length === 0) {
        setError("没识别出商品，换一张更清楚的照片，或用 Opus 5.5 重试");
        setLines(null);
      } else {
        setLines(r.items.map((i, n) => ({ id: `l${n}-${Date.now()}`, name: i.name, pricePence: i.pricePence, includesMe: false, contactIds: [] })));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function onPick(file: File | undefined) {
    if (!file) return;
    setBusy("正在上传…");
    setError(null);
    try {
      const { data } = await sb.auth.getUser();
      const path = await uploadImage(sb, data.user!.id, await compressImage(file), "receipt");
      setImagePath(path);
      await run(path);
    } catch (e) {
      setError(e instanceof ImageDecodeError ? e.message : `上传失败：${(e as Error).message}`);
      setBusy(null);
    }
  }

  const patch = (id: string, p: Partial<Line>) => setLines((ls) => ls?.map((l) => (l.id === id ? { ...l, ...p } : l)) ?? null);
  const toggleOwner = (l: Line, owner: string | null) =>
    owner === null
      ? patch(l.id, { includesMe: !l.includesMe })
      : patch(l.id, { contactIds: l.contactIds.includes(owner) ? l.contactIds.filter((x) => x !== owner) : [...l.contactIds, owner] });
  const giveAllTo = (owner: string | null) =>
    setLines((ls) =>
      ls?.map((l) => ({ ...l, includesMe: owner === null, contactIds: owner === null ? [] : [owner] })) ?? null,
    );

  const itemsTotal = (lines ?? []).reduce((s, l) => s + l.pricePence, 0);
  const missing = lines ? unassignedLines(lines) : [];
  const ready = !!lines && lines.length > 0 && missing.length === 0;
  const diff = target.amountPence - itemsTotal;
  const shares = ready ? receiptSplit(lines!, target.amountPence, reconcile) : [];
  const nameOf = (id: string | null) => owners.find((o) => o.id === id)?.name ?? "?";

  async function confirm() {
    if (!ready || !imagePath) return;
    setBusy("保存中…");
    setError(null);
    try {
      await saveReceipt(sb, target.id, {
        imagePath,
        totalPence: itemsTotal,
        model,
        lines: lines!,
        names: Object.fromEntries(lines!.map((l) => [l.id, l.name])),
      });
      await onDone(shares);
    } catch (e) {
      setError(`保存失败：${(e as Error).message}`);
      setBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-bg" role="dialog" aria-label="按小票分">
      <div className="mx-auto flex max-w-[480px] flex-col gap-4 px-4 pt-5" style={{ paddingBottom: "calc(120px + env(safe-area-inset-bottom, 0px))" }}>
        <header className="flex items-center justify-between">
          <button className="text-sm text-muted" onClick={onCancel}>取消</button>
          <h2 className="font-bold">按小票分</h2>
          <span className="w-8" />
        </header>
        <p className="num text-center text-[13px] text-muted">
          {target.merchant} · 银行扣款 {formatPence(target.amountPence)}
        </p>

        <input ref={input} id="receipt-photo" type="file" accept="image/*" capture="environment" hidden onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = ""; }} />

        {!lines && (
          <button className="card flex flex-col items-center gap-2 p-8" onClick={() => input.current?.click()} disabled={!!busy}>
            <span className="text-lg font-bold">{busy ?? "拍小票或从相册选"}</span>
            <span className="text-sm text-muted">AI 会列出上面的每一样商品</span>
          </button>
        )}

        {error && <p className="card p-3 text-sm text-danger" role="alert">{error}</p>}

        {lines && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted">一键全给：</span>
              {owners.map((o) => (
                <button key={o.id ?? "me"} className="rounded-full border border-line bg-surface px-3 py-1" onClick={() => giveAllTo(o.id)}>
                  {o.name}
                </button>
              ))}
              <button className="ml-auto text-accent" disabled={!!busy || !imagePath} onClick={() => imagePath && run(imagePath, "opus")}>
                用 Opus 5.5 重新识别
              </button>
            </div>

            <ul className="flex flex-col gap-2">
              {lines.map((l) => {
                const unassigned = missing.includes(l.id);
                return (
                  <li key={l.id} className={`card flex flex-col gap-2 p-3 ${unassigned ? "border-later" : ""}`}>
                    <div className="grid grid-cols-[1fr_88px_auto] items-center gap-2">
                      <input id={`n-${l.id}`} className="field py-1.5" value={l.name} onChange={(e) => patch(l.id, { name: e.target.value })} aria-label="商品名" />
                      <input
                        id={`p-${l.id}`}
                        key={l.pricePence}
                        className="field num py-1.5 text-right"
                        inputMode="decimal"
                        defaultValue={(l.pricePence / 100).toFixed(2)}
                        onBlur={(e) => {
                          const v = parsePounds(e.target.value);
                          if (v === null) e.target.value = (l.pricePence / 100).toFixed(2);
                          else patch(l.id, { pricePence: v });
                        }}
                        aria-label="价格"
                      />
                      <button className="text-sm text-muted" onClick={() => setLines((ls) => ls?.filter((x) => x.id !== l.id) ?? null)} aria-label={`删除 ${l.name}`}>
                        删除
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {owners.map((o) => {
                        const on = o.id === null ? l.includesMe : l.contactIds.includes(o.id);
                        return (
                          <button
                            key={o.id ?? "me"}
                            aria-pressed={on}
                            onClick={() => toggleOwner(l, o.id)}
                            className={`rounded-full border px-3 py-1 text-sm ${on ? "border-accent bg-accent-soft text-accent" : "border-line bg-phone"}`}
                          >
                            {o.name}
                          </button>
                        );
                      })}
                      {(l.includesMe && l.contactIds.length > 0) || l.contactIds.length > 1 ? (
                        <span className="self-center text-xs text-muted">共享，平分</span>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
            <button
              className="rounded-xl border border-dashed border-line py-2 text-sm text-muted"
              onClick={() => setLines((ls) => [...(ls ?? []), { id: `l-new-${Date.now()}`, name: "", pricePence: 0, includesMe: false, contactIds: [] }])}
            >
              + 手动加一行
            </button>

            {diff !== 0 && (
              <div className="card flex flex-col gap-2 p-3 text-sm">
                <p className="num">
                  小票合计 {formatPence(itemsTotal)}，银行扣款 {formatPence(target.amountPence)}，差 {formatPence(diff)}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {(["proportional", "me"] as const).map((r) => (
                    <button
                      key={r}
                      aria-pressed={reconcile === r}
                      onClick={() => setReconcile(r)}
                      className={`rounded-xl px-3 py-2 ${reconcile === r ? "border-2 border-accent" : "border border-line"}`}
                    >
                      {r === "proportional" ? "按比例分摊" : "差额算我的"}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {lines && (
        <div className="fixed inset-x-0 bottom-0 border-t border-line bg-surface" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
          <div className="mx-auto flex max-w-[480px] flex-col gap-2 px-4 py-3">
            <p className="num text-[13px] text-muted">
              {ready
                ? shares.map((s) => `${nameOf(s.contactId)} ${formatPence(s.sharePence)}`).join("　")
                : `还有 ${missing.length} 样没选是谁的`}
            </p>
            <button className="btn btn-primary" disabled={!ready || !!busy} onClick={confirm}>
              {busy ?? "确认分账"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
