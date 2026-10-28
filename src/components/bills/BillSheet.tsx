"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BANK_LABEL } from "@/lib/banks";
import { CATEGORIES, CATEGORY_LABEL, type Category } from "@/lib/categories";
import { changeBillStatus, deleteBill, itemOwners, STATUS_LABEL, updateBill, type Bill } from "@/lib/data/bills";
import type { Contact } from "@/lib/db/types";
import { formatPence, parsePounds } from "@/lib/money";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { EditSplit } from "./EditSplit";

type Move = { label: string; to: "pending" | "personal" | "transfer"; thenReview?: boolean };

function movesFor(bill: Bill): Move[] {
  switch (bill.status) {
    case "shared":
      return [
        { label: "重新分账", to: "pending", thenReview: true },
        { label: "改成我自己的", to: "personal" },
        { label: "改成转账/收入", to: "transfer" },
      ];
    case "personal":
      return [
        { label: "改成一起的（去分账）", to: "pending", thenReview: true },
        { label: "改成转账/收入", to: "transfer" },
      ];
    case "transfer":
      return [
        { label: "改成我自己的", to: "personal" },
        { label: "改成一起的（去分账）", to: "pending", thenReview: true },
      ];
    default:
      return [
        { label: "改成我自己的", to: "personal" },
        { label: "改成转账/收入", to: "transfer" },
      ];
  }
}

/** Bottom sheet for one bill: edit its details, move it between buckets, or delete it. */
export function BillSheet({
  bill,
  contacts,
  onClose,
  onChanged,
}: {
  bill: Bill;
  contacts: Contact[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const sb = createBrowserSupabase();
  const router = useRouter();
  const [merchant, setMerchant] = useState(bill.merchant);
  const [date, setDate] = useState(bill.occurred_on);
  const [amount, setAmount] = useState((Math.abs(bill.amount_pence) / 100).toFixed(2));
  const [category, setCategory] = useState<Category>(bill.category);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState<{ drop?: string } | null>(null);
  const [confirmDrop, setConfirmDrop] = useState<string | null>(null);

  const split = bill.splits.length > 0;
  const income = bill.amount_pence < 0;
  const parsed = parsePounds(amount);
  const newAmount = parsed === null ? null : income ? -Math.abs(parsed) : Math.abs(parsed);
  const dirty =
    merchant.trim() !== bill.merchant || date !== bill.occurred_on || category !== bill.category || newAmount !== bill.amount_pence;
  const nameOf = (id: string | null) => (id === null ? "我" : (contacts.find((c) => c.id === id)?.name ?? "?"));

  async function run(action: () => Promise<void>, after?: () => void) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
      after ? after() : onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  function save() {
    if (newAmount === null || newAmount === 0) return setError("金额格式不对，例如 12.50");
    if (!date) return setError("请选择日期");
    run(() => updateBill(sb, bill, { merchant, occurredOn: date, category, amountPence: newAmount }));
  }

  if (editing) {
    return (
      <EditSplit
        bill={bill}
        contacts={contacts}
        dropContactId={editing.drop}
        onCancel={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          onChanged();
        }}
      />
    );
  }

  const others = bill.splits.filter((s) => s.contact_id !== null);

  /** Take one person out. The last one leaving means nobody shares it any more. */
  function drop(contactId: string) {
    if (others.length > 1) return setEditing({ drop: contactId });
    if (confirmDrop !== contactId) return setConfirmDrop(contactId);
    run(() => changeBillStatus(sb, bill, "personal"));
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-label="账单详情"
        className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[88dvh] max-w-[480px] flex-col gap-4 overflow-y-auto rounded-t-3xl bg-surface px-5 pt-2.5"
        style={{ paddingBottom: "calc(20px + env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="mx-auto h-1.5 w-10 rounded-full bg-line" />
        <div className="flex items-center gap-2 text-xs">
          <span className="num rounded-md bg-accent-soft px-2 py-0.5 text-accent">{BANK_LABEL[bill.bank]}</span>
          <span className="rounded-md bg-line/60 px-2 py-0.5 text-muted">{STATUS_LABEL[bill.status]}</span>
          <button className="ml-auto text-sm text-muted" onClick={onClose}>关闭</button>
        </div>

        <input id="bill-merchant" className="field font-semibold" value={merchant} onChange={(e) => setMerchant(e.target.value)} aria-label="商家" />
        {bill.merchant_raw !== bill.merchant && <p className="-mt-2 truncate text-xs text-muted">账单原文：{bill.merchant_raw}</p>}

        <div className="grid grid-cols-2 gap-2">
          <input id="bill-date" className="field num" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="日期" />
          <input
            id="bill-amount"
            className="field num disabled:opacity-60"
            inputMode="decimal"
            value={amount}
            disabled={split}
            onChange={(e) => setAmount(e.target.value)}
            aria-label={income ? "收入金额" : "金额"}
          />
        </div>
        {split && <p className="-mt-2 text-xs text-muted">已经分过账，要改金额请先点「重新分账」。</p>}
        {income && <p className="-mt-2 text-xs text-muted">这是一笔收入/转入。</p>}

        <select id="bill-category" className="field" value={category} onChange={(e) => setCategory(e.target.value as Category)} aria-label="分类">
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
          ))}
        </select>

        {dirty && (
          <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "保存中…" : "保存修改"}</button>
        )}

        {split && (
          <section className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between">
              <h3 className="text-sm text-muted">{bill.receipt ? "按小票分的" : "平均分的"}</h3>
              <button className="text-sm text-accent" disabled={busy} onClick={() => setEditing({})}>修改分账</button>
            </div>
            <ul className="card divide-y divide-line">
              {bill.splits.map((s, i) => (
                <li key={i} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="flex-1">{nameOf(s.contact_id)}{s.contact_id && " 欠你"}</span>
                  <span className="num">{formatPence(s.share_pence)}</span>
                  {s.contact_id && (
                    <button className="text-xs text-danger" disabled={busy} onClick={() => drop(s.contact_id!)}>
                      {confirmDrop === s.contact_id ? "确认撤销？" : "去掉"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted">
              {others.length > 1
                ? "去掉一个人后，剩下的人会一起重新算。"
                : "去掉最后一个同学，这笔就变成你自己的，TA 不再欠这笔钱。"}
            </p>
          </section>
        )}

        {bill.receipt && (
          <section className="flex flex-col gap-1.5">
            <h3 className="text-sm text-muted">小票明细（{bill.receipt.receipt_items.length} 样）</h3>
            <ul className="card divide-y divide-line">
              {bill.receipt.receipt_items.map((item, i) => (
                <li key={i} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{item.name || "（没名字）"}</span>
                    <span className="block truncate text-xs text-accent">{itemOwners(item, contacts).join("、")}</span>
                  </span>
                  <span className="num shrink-0">{formatPence(item.price_pence)}</span>
                </li>
              ))}
            </ul>
            {bill.receipt.total_pence !== bill.amount_pence && (
              <p className="num text-xs text-muted">
                小票合计 {formatPence(bill.receipt.total_pence)}，银行扣款 {formatPence(bill.amount_pence)}，差额已经算进上面的金额里。
              </p>
            )}
          </section>
        )}

        <section className="flex flex-col gap-2">
          <h3 className="text-sm text-muted">这笔其实是…</h3>
          <div className="grid grid-cols-2 gap-2">
            {movesFor(bill).map((m) => (
              <button
                key={m.label}
                className="btn py-2 text-sm"
                disabled={busy}
                onClick={() => run(() => changeBillStatus(sb, bill, m.to), m.thenReview ? () => router.push("/review") : undefined)}
              >
                {m.label}
              </button>
            ))}
            {(bill.status === "pending" || bill.status === "later") && (
              <button className="btn py-2 text-sm" onClick={() => router.push("/review")}>去逐笔确认</button>
            )}
          </div>
          {split && <p className="text-xs text-muted">改成别的会清掉现在的分账，同学那边的欠款也会跟着变。</p>}
        </section>

        {error && <p className="text-sm text-danger" role="alert">{error}</p>}

        <button
          className={`btn py-2 text-sm text-danger ${confirmDelete ? "border-danger" : ""}`}
          disabled={busy}
          onClick={() => (confirmDelete ? run(() => deleteBill(sb, bill.id)) : setConfirmDelete(true))}
        >
          {confirmDelete ? (split ? "确认删除？分账也会一起删掉" : "确认删除？") : "删除这笔"}
        </button>
      </div>
    </>
  );
}
