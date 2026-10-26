"use client";

import { useEffect, useState } from "react";
import { CATEGORY_COLOR, CATEGORY_LABEL } from "@/lib/categories";
import { loadMonthlySpend, type MonthlySpend as Spend } from "@/lib/data/dashboard";
import { formatPence } from "@/lib/money";
import { createBrowserSupabase } from "@/lib/supabase/browser";

const thisMonth = () => new Date().toISOString().slice(0, 7);

function shift(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export function MonthlySpend() {
  const [month, setMonth] = useState(thisMonth);
  const [spend, setSpend] = useState<Spend | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSpend(null);
    loadMonthlySpend(createBrowserSupabase(), month)
      .then(setSpend)
      .catch((e) => setError((e as Error).message));
  }, [month]);

  const [y, m] = month.split("-");
  const max = Math.max(1, ...(spend?.byCategory.map((c) => c.pence) ?? [1]));

  return (
    <section className="card flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <button className="px-2 text-xl text-muted" onClick={() => setMonth((x) => shift(x, -1))} aria-label="上个月">‹</button>
        <h2 className="font-bold">{y}年{Number(m)}月 我的支出</h2>
        <button
          className="px-2 text-xl text-muted disabled:opacity-30"
          onClick={() => setMonth((x) => shift(x, 1))}
          disabled={month >= thisMonth()}
          aria-label="下个月"
        >
          ›
        </button>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      {spend && (
        <>
          <p className="num text-center text-4xl tracking-tight">{formatPence(spend.totalPence)}</p>
          {spend.pendingCount > 0 && (
            <p className="-mt-2 text-center text-xs text-muted">含 {spend.pendingCount} 笔待确认，按全额计</p>
          )}
          {spend.byCategory.length === 0 ? (
            <p className="text-center text-sm text-muted">这个月还没有支出</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {spend.byCategory.map((c) => (
                <li key={c.category} className="grid grid-cols-[64px_1fr_auto] items-center gap-2 text-sm">
                  <span>{CATEGORY_LABEL[c.category]}</span>
                  <span className="h-2.5 overflow-hidden rounded-full bg-phone">
                    <span
                      className="block h-full rounded-full"
                      style={{ width: `${(c.pence / max) * 100}%`, background: CATEGORY_COLOR[c.category] }}
                    />
                  </span>
                  <span className="num text-right">{formatPence(c.pence)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {!spend && !error && <p className="text-center text-sm text-muted">加载中…</p>}
    </section>
  );
}
