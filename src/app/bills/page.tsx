"use client";

import { use, useCallback, useEffect, useState } from "react";
import { BillSheet } from "@/components/bills/BillSheet";
import { PENDING_CHANGED } from "@/components/BottomNav";
import { CATEGORIES, CATEGORY_LABEL, type Category } from "@/lib/categories";
import {
  addManualBill,
  FILTER_LABEL,
  filterBills,
  groupByMonth,
  loadBills,
  splitSummary,
  STATUS_LABEL,
  type Bill,
  type BillFilter,
} from "@/lib/data/bills";
import type { Contact } from "@/lib/db/types";
import { formatCnDate } from "@/lib/dates";
import { formatPence, parsePounds } from "@/lib/money";
import { createBrowserSupabase } from "@/lib/supabase/browser";

const FILTERS: BillFilter[] = ["all", "shared", "personal", "transfer", "pending"];

const today = () => new Date().toLocaleDateString("en-CA");

export default function BillsPage({ searchParams }: { searchParams: Promise<{ tx?: string }> }) {
  const { tx } = use(searchParams);
  const sb = createBrowserSupabase();
  const [data, setData] = useState<{ bills: Bill[]; contacts: Contact[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<BillFilter>("all");
  const [openId, setOpenId] = useState<string | null>(tx ?? null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(
    () =>
      loadBills(sb)
        .then(setData)
        .catch((e) => setError((e as Error).message)),
    [sb],
  );
  useEffect(() => {
    load();
  }, [load]);

  // Edits can add to or empty the review queue, so the nav badge refreshes too.
  const changed = () => {
    load();
    window.dispatchEvent(new Event(PENDING_CHANGED));
  };

  const open = data?.bills.find((b) => b.id === openId) ?? null;
  const shown = data ? filterBills(data.bills, filter) : [];

  return (
    <main className="mx-auto flex max-w-[480px] flex-col gap-4 px-4 pt-6">
      <header className="flex items-baseline justify-between">
        <h1 className="font-display text-2xl font-extrabold">账单</h1>
        <button className="text-sm text-accent" onClick={() => setAdding((v) => !v)}>{adding ? "收起" : "+ 手动记一笔"}</button>
      </header>

      {adding && (
        <ManualBillForm
          onAdded={() => {
            setAdding(false);
            changed();
          }}
        />
      )}

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {FILTERS.map((f) => {
          const n = data ? filterBills(data.bills, f).length : 0;
          return (
            <button
              key={f}
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm ${filter === f ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface"}`}
            >
              {FILTER_LABEL[f]} <span className="num text-xs">{n}</span>
            </button>
          );
        })}
      </div>

      {error && <p className="card p-4 text-sm text-danger">加载失败：{error}</p>}
      {!data && !error && <p className="text-sm text-muted">加载中…</p>}
      {data && shown.length === 0 && (
        <p className="card p-4 text-sm text-muted">{filter === "all" ? "还没有账单。去「导入」上传截图或 CSV，或者手动记一笔。" : "这一类还没有账单。"}</p>
      )}

      {groupByMonth(shown).map((g) => (
        <section key={g.month} className="flex flex-col gap-2">
          <h2 className="flex justify-between text-sm text-muted">
            <span className="tracking-widest">{g.label}</span>
            {g.spentPence > 0 && <span className="num">支出 {formatPence(g.spentPence)}</span>}
          </h2>
          <ul className="card divide-y divide-line">
            {g.bills.map((b) => {
              const summary = splitSummary(b, data!.contacts);
              return (
                <li key={b.id}>
                  <button className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={() => setOpenId(b.id)}>
                    <span className="num w-14 shrink-0 whitespace-nowrap text-xs text-muted">{formatCnDate(b.occurred_on)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{b.merchant}</span>
                      <span className="block truncate text-xs text-muted">
                        {CATEGORY_LABEL[b.category]} · {summary ?? STATUS_LABEL[b.status]}
                      </span>
                    </span>
                    <span className={`num shrink-0 ${b.amount_pence < 0 ? "text-ok" : b.status === "shared" ? "text-accent" : ""}`}>
                      {b.amount_pence < 0 ? "+" : ""}
                      {formatPence(Math.abs(b.amount_pence))}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {open && data && (
        <BillSheet key={open.id} bill={open} contacts={data.contacts} onClose={() => setOpenId(null)} onChanged={changed} />
      )}
    </main>
  );
}

function ManualBillForm({ onAdded }: { onAdded: () => void }) {
  const [merchant, setMerchant] = useState("");
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<Category>("other");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const pence = parsePounds(amount);
    if (!pence || pence <= 0) return setError("请输入大于 0 的金额，例如 12.50");
    setBusy(true);
    setError(null);
    try {
      await addManualBill(createBrowserSupabase(), { merchant, occurredOn: date, amountPence: pence, category });
      onAdded();
    } catch (err) {
      setError(`保存失败：${(err as Error).message}`);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card flex flex-col gap-3 p-4">
      <input id="manual-merchant" className="field" placeholder="花在哪（例如 Tesco、房租）" maxLength={60} required value={merchant} onChange={(e) => setMerchant(e.target.value)} />
      <div className="grid grid-cols-2 gap-2">
        <input id="manual-date" className="field num" type="date" required value={date} onChange={(e) => setDate(e.target.value)} aria-label="日期" />
        <input id="manual-amount" className="field num" inputMode="decimal" placeholder="金额（£）" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <select id="manual-category" className="field" value={category} onChange={(e) => setCategory(e.target.value as Category)} aria-label="分类">
        {CATEGORIES.filter((c) => c !== "transfer").map((c) => (
          <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
        ))}
      </select>
      <p className="text-xs text-muted">记好后会进「待处理」，在那里决定是自己的还是一起分。</p>
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      <button className="btn btn-primary" disabled={busy || !merchant.trim()}>{busy ? "保存中…" : "记下来"}</button>
    </form>
  );
}
