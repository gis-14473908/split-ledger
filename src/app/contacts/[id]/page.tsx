"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import {
  deleteSettlement,
  loadContactDetail,
  settle,
  updateSettlement,
  type LedgerEntry,
  type SettlementRow,
} from "@/lib/data/contacts";
import { createInviteLink } from "@/lib/data/dashboard";
import type { Contact } from "@/lib/db/types";
import { formatCnDate } from "@/lib/dates";
import { formatPence, parsePounds } from "@/lib/money";
import { createBrowserSupabase } from "@/lib/supabase/browser";

type Detail = { contact: Contact; entries: LedgerEntry[]; balance: number };

export default function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const sb = createBrowserSupabase();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settling, setSettling] = useState(false);
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [invite, setInvite] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(() => {
    loadContactDetail(sb, id)
      .then((d) => {
        setDetail(d);
        setDirection(d.balance >= 0 ? "in" : "out");
        setAmount(d.balance ? (Math.abs(d.balance) / 100).toFixed(2) : "");
      })
      .catch((e) => setError((e as Error).message));
  }, [sb, id]);

  useEffect(load, [load]);

  async function saveSettlement(e: React.FormEvent) {
    e.preventDefault();
    const pence = parsePounds(amount);
    if (!pence || pence <= 0) return setError("请输入大于 0 的金额");
    setBusy(true);
    setError(null);
    try {
      await settle(sb, id, direction === "in" ? pence : -pence, note);
      setSettling(false);
      setNote("");
      load();
    } catch (err) {
      setError(`保存失败：${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function makeInvite() {
    setBusy(true);
    try {
      setInvite(await createInviteLink(sb, id, location.origin));
    } catch (err) {
      setError(`生成失败：${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function copy(e: React.MouseEvent<HTMLButtonElement>) {
    try {
      await navigator.clipboard.writeText(invite!);
      setCopied(true);
    } catch {
      const input = e.currentTarget.previousElementSibling as HTMLInputElement | null;
      input?.select();
    }
  }

  if (error && !detail) return <p className="card m-4 p-4 text-sm text-danger">{error}</p>;
  if (!detail) return <p className="p-8 text-center text-muted">加载中…</p>;
  const { contact, entries, balance } = detail;

  return (
    <main className="mx-auto flex max-w-[480px] flex-col gap-5 px-4 pt-5">
      <Link href="/" className="text-sm text-muted">‹ 面板</Link>
      <header className="flex flex-col items-center gap-1 text-center">
        <span className="grid size-14 place-items-center rounded-full bg-accent-soft text-2xl font-bold text-accent">{contact.name.slice(0, 1)}</span>
        <h1 className="font-display text-2xl font-extrabold">{contact.name}</h1>
        <p className="text-xs text-muted">{contact.linked_user_id ? "已关联 TA 的账号" : "还没关联账号"}</p>
        <p className={`num mt-2 text-4xl ${balance > 0 ? "text-accent" : balance < 0 ? "text-later" : "text-muted"}`}>
          {balance === 0 ? "两清" : formatPence(Math.abs(balance))}
        </p>
        {balance !== 0 && <p className="text-sm text-muted">{balance > 0 ? `${contact.name} 欠你` : `你欠 ${contact.name}`}</p>}
      </header>

      <div className="grid grid-cols-2 gap-2">
        <button className="btn btn-primary" onClick={() => setSettling((v) => !v)}>记一笔还款</button>
        {!contact.linked_user_id && (
          <button className="btn" onClick={makeInvite} disabled={busy}>邀请 TA 注册</button>
        )}
      </div>

      {invite && (
        <div className="card flex flex-col gap-2 p-3">
          <p className="text-sm">把这个链接发给 {contact.name}，TA 注册或登录后点确认，就能看到欠你多少：</p>
          <div className="flex gap-2">
            <input id="invite-link" className="field num text-xs" readOnly value={invite} onFocus={(e) => e.target.select()} />
            <button className="btn shrink-0 py-2" onClick={copy}>{copied ? "已复制" : "复制"}</button>
          </div>
        </div>
      )}

      {settling && (
        <form onSubmit={saveSettlement} className="card flex flex-col gap-3 p-3">
          <div className="grid grid-cols-2 gap-2">
            {(["in", "out"] as const).map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={direction === d}
                onClick={() => setDirection(d)}
                className={`rounded-xl px-3 py-2 text-sm ${direction === d ? "border-2 border-accent" : "border border-line"}`}
              >
                {d === "in" ? `${contact.name} 转给我` : `我转给 ${contact.name}`}
              </button>
            ))}
          </div>
          <input id="settle-amount" className="field num" inputMode="decimal" placeholder="金额（£）" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <input id="settle-note" className="field" placeholder="备注（可选）" maxLength={50} value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn btn-primary" disabled={busy}>{busy ? "保存中…" : "保存"}</button>
        </form>
      )}

      {error && <p className="text-sm text-danger" role="alert">{error}</p>}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm tracking-widest text-muted">明细</h2>
        {entries.length === 0 ? (
          <p className="card p-4 text-sm text-muted">还没有记录</p>
        ) : (
          <ul className="card divide-y divide-line">
            {entries.map((e, i) => {
              const row = (
                <>
                  <span className="num w-14 shrink-0 text-xs text-muted">{formatCnDate(e.date)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{e.title}</span>
                    {e.detail && <span className="line-clamp-3 block text-xs text-muted">{e.detail}</span>}
                  </span>
                  <span className={`num ${e.pence > 0 ? "text-accent" : "text-later"}`}>
                    {e.pence > 0 ? "+" : "−"}
                    {formatPence(Math.abs(e.pence))}
                  </span>
                  {e.ref && <span className="text-muted" aria-hidden>›</span>}
                </>
              );
              const cls = "flex w-full items-center gap-3 px-4 py-3 text-left";
              if (e.ref?.type === "bill") {
                return (
                  <li key={i}>
                    <Link href={`/bills?tx=${e.ref.id}`} className={cls}>{row}</Link>
                  </li>
                );
              }
              if (e.ref?.type === "settlement") {
                const s = e.ref.settlement;
                return (
                  <li key={i}>
                    <button className={cls} onClick={() => setEditing((cur) => (cur === s.id ? null : s.id))}>{row}</button>
                    {editing === s.id && (
                      <SettlementEditor
                        settlement={s}
                        name={contact.name}
                        onDone={() => {
                          setEditing(null);
                          load();
                        }}
                      />
                    )}
                  </li>
                );
              }
              return (
                <li key={i} className={cls}>{row}</li>
              );
            })}
          </ul>
        )}
        <p className="text-xs text-muted">“+” 表示 TA 欠你的增加，“−” 表示减少。点一条可以修改或删除（对方记的那几条只能 TA 自己改）。</p>
      </section>
    </main>
  );
}

/** Inline editor for a repayment or opening balance I recorded. */
function SettlementEditor({ settlement, name, onDone }: { settlement: SettlementRow; name: string; onDone: () => void }) {
  const opening = settlement.kind === "opening";
  // Stored sign: positive = they paid me (payment) / I owed them (opening).
  const [positive, setPositive] = useState(settlement.amount_pence > 0);
  const [amount, setAmount] = useState((Math.abs(settlement.amount_pence) / 100).toFixed(2));
  const [date, setDate] = useState(settlement.settled_on);
  const [note, setNote] = useState(settlement.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const sb = createBrowserSupabase();

  const options: { positive: boolean; label: string }[] = opening
    ? [
        { positive: false, label: `${name} 欠我` },
        { positive: true, label: `我欠 ${name}` },
      ]
    : [
        { positive: true, label: `${name} 转给我` },
        { positive: false, label: `我转给 ${name}` },
      ];

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    const pence = parsePounds(amount);
    if (!pence || pence <= 0) return setError("请输入大于 0 的金额");
    if (!date) return setError("请选择日期");
    run(() => updateSettlement(sb, settlement.id, { amountPence: positive ? pence : -pence, settledOn: date, note }));
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-2 bg-phone px-4 pt-1 pb-4">
      <p className="text-xs text-muted">{opening ? "修改起始欠款" : "修改这笔还款"}</p>
      <div className="grid grid-cols-2 gap-2">
        {options.map((o) => (
          <button
            key={o.label}
            type="button"
            aria-pressed={positive === o.positive}
            onClick={() => setPositive(o.positive)}
            className={`rounded-xl px-3 py-2 text-sm ${positive === o.positive ? "border-2 border-accent bg-surface" : "border border-line bg-surface"}`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input className="field num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="金额" />
        <input className="field num" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="日期" />
      </div>
      <input className="field" placeholder="备注（可选）" maxLength={50} value={note} onChange={(e) => setNote(e.target.value)} aria-label="备注" />
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          className="btn py-2 text-sm text-danger"
          disabled={busy}
          onClick={() => (confirmDelete ? run(() => deleteSettlement(sb, settlement.id)) : setConfirmDelete(true))}
        >
          {confirmDelete ? "确认删除？" : "删除"}
        </button>
        <button className="btn btn-primary py-2 text-sm" disabled={busy}>{busy ? "保存中…" : "保存"}</button>
      </div>
    </form>
  );
}
