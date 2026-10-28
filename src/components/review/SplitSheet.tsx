"use client";

import { useState } from "react";
import type { Contact } from "@/lib/db/types";
import { formatPence } from "@/lib/money";
import { equalSplit, type Share } from "@/lib/split/equal";

export type SplitTarget = { id: string; merchant: string; amountPence: number };

/**
 * Bottom sheet opened by a right swipe. Sits above the card deck (z-40) so it is never covered.
 * Equal split confirms here; "by receipt" hands the chosen people to onReceipt.
 */
export function SplitSheet({
  target,
  contacts,
  onCreateContact,
  onCancel,
  onEqual,
  onReceipt,
  initial,
}: {
  target: SplitTarget;
  contacts: Contact[];
  onCreateContact: (name: string) => Promise<Contact>;
  onCancel: () => void;
  onEqual: (shares: Share[]) => Promise<void>;
  onReceipt: (people: { includeMe: boolean; contactIds: string[] }) => void;
  /** Who and how, when changing a split that already exists. */
  initial?: { includeMe: boolean; contactIds: string[]; mode: "even" | "receipt"; hasReceipt: boolean };
}) {
  const [includeMe, setIncludeMe] = useState(initial?.includeMe ?? true);
  const [picked, setPicked] = useState<string[]>(initial?.contactIds ?? []);
  const [mode, setMode] = useState<"even" | "receipt">(initial?.mode ?? "even");
  const receiptStep = initial?.hasReceipt ? "下一步：调整每样商品是谁的" : "下一步：拍小票 → 逐个商品点选是谁的";
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const participants = [...(includeMe ? [null] : []), ...picked];
  const preview = picked.length ? equalSplit(target.amountPence, participants) : [];
  const nameOf = (id: string | null) => (id === null ? "你自己" : (contacts.find((c) => c.id === id)?.name ?? ""));

  async function addContact() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const c = await onCreateContact(name);
      setPicked((p) => [...p, c.id]);
      setNewName("");
      setAdding(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!picked.length) return;
    if (mode === "receipt") return onReceipt({ includeMe, contactIds: picked });
    setBusy(true);
    setError(null);
    try {
      await onEqual(preview);
    } catch {
      setError("保存失败，请重试");
      setBusy(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onCancel} aria-hidden />
      <div
        role="dialog"
        aria-label="和谁一起"
        className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[88dvh] max-w-[480px] flex-col gap-4 overflow-y-auto rounded-t-3xl bg-surface px-5 pt-2.5"
        style={{ paddingBottom: "calc(20px + env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="mx-auto h-1.5 w-10 rounded-full bg-line" />
        <div>
          <h2 className="text-lg font-bold">{initial ? "修改分账" : "和谁一起？"}</h2>
          <p className="num text-[13px] text-muted">
            {target.merchant} · {formatPence(target.amountPence)}
          </p>
        </div>

        <div>
          <p className="mb-1.5 text-xs tracking-widest text-muted">选人（可多选）</p>
          <div className="flex flex-wrap gap-2">
            <Chip on={includeMe} onClick={() => setIncludeMe((v) => !v)}>我</Chip>
            {contacts.map((c) => (
              <Chip key={c.id} on={picked.includes(c.id)} onClick={() => toggle(c.id)}>
                {c.name}
              </Chip>
            ))}
            {adding ? (
              <form
                className="flex gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  addContact();
                }}
              >
                <input
                  id="new-contact"
                  autoFocus
                  className="field w-28 py-1.5"
                  placeholder="名字"
                  maxLength={20}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
                <button className="btn py-1.5" disabled={busy || !newName.trim()}>添加</button>
              </form>
            ) : (
              <button type="button" className="rounded-full border border-dashed border-line px-3.5 py-1.5 text-sm text-muted" onClick={() => setAdding(true)}>
                + 写个新名字
              </button>
            )}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-xs tracking-widest text-muted">怎么分</p>
          <div className="grid grid-cols-2 gap-2">
            <ModeButton on={mode === "even"} onClick={() => setMode("even")} title="平均分" sub="总额按人头平摊" />
            <ModeButton on={mode === "receipt"} onClick={() => setMode("receipt")} title="按小票分" sub="拍小票，逐个商品选归属" />
          </div>
        </div>

        <div className="num rounded-xl bg-phone px-3 py-2.5 text-[13px] text-muted">
          {!picked.length
            ? "至少选一个同学"
            : mode === "receipt"
              ? receiptStep
              : preview
                  .map((s) => (s.contactId === null ? `你自己 ${formatPence(s.sharePence)}` : `${nameOf(s.contactId)} 欠你 ${formatPence(s.sharePence)}`))
                  .join("　") + (includeMe ? "" : "（你代付，不含自己）")}
        </div>

        {error && <p className="text-sm text-danger" role="alert">{error}</p>}

        <div className="grid grid-cols-[auto_1fr] gap-2">
          <button type="button" className="btn" onClick={onCancel}>取消</button>
          <button type="button" className="btn btn-primary" disabled={!picked.length || busy} onClick={confirm}>
            {mode === "receipt" ? (initial?.hasReceipt ? "下一步" : "去拍小票") : busy ? "保存中…" : "确认分账"}
          </button>
        </div>
      </div>
    </>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`rounded-full border px-3.5 py-1.5 text-sm ${on ? "border-accent bg-accent-soft text-accent" : "border-line bg-phone"}`}
    >
      {children}
    </button>
  );
}

function ModeButton({ on, onClick, title, sub }: { on: boolean; onClick: () => void; title: string; sub: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`rounded-2xl bg-phone px-3 py-2.5 text-left text-xs text-muted ${on ? "border-2 border-accent" : "border border-line"}`}
    >
      <b className="block text-[15px] text-ink">{title}</b>
      {sub}
    </button>
  );
}
