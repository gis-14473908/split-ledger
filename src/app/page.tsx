"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AddContactForm } from "@/components/contacts/AddContactForm";
import { BalanceList } from "@/components/dashboard/BalanceList";
import { MonthlySpend } from "@/components/dashboard/MonthlySpend";
import { loadBalances, type BalanceRow } from "@/lib/data/dashboard";
import { formatPence } from "@/lib/money";
import { createBrowserSupabase } from "@/lib/supabase/browser";

export default function Dashboard() {
  const [rows, setRows] = useState<BalanceRow[] | null>(null);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [onboarding, setOnboarding] = useState(false);
  const [addedCount, setAddedCount] = useState(0);

  const reload = () =>
    loadBalances(createBrowserSupabase())
      .then(setRows)
      .catch((e) => setError((e as Error).message));

  useEffect(() => {
    const sb = createBrowserSupabase();
    reload();
    // First visit with nothing in the ledger: offer to add friends and old debts.
    Promise.all([
      sb.from("contacts").select("id", { count: "exact", head: true }),
      sb.from("transactions").select("id", { count: "exact", head: true }),
    ]).then(([c, t]) => {
      let dismissed = false;
      try {
        dismissed = localStorage.getItem("onboarding-done") === "1";
      } catch {}
      if (!dismissed && c.count === 0 && t.count === 0) setOnboarding(true);
    });
    sb.from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .then(({ count }) => setPending(count ?? 0));
  }, []);

  function finishOnboarding() {
    try {
      localStorage.setItem("onboarding-done", "1");
    } catch {}
    setOnboarding(false);
  }

  const owedToMe = rows?.reduce((s, r) => s + Math.max(0, r.pence), 0) ?? 0;

  return (
    <main className="mx-auto flex max-w-[480px] flex-col gap-5 px-4 pt-6">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted">同学一共欠你</p>
        <p className="num text-5xl tracking-tight">{rows ? formatPence(owedToMe) : "—"}</p>
      </header>

      {onboarding && (
        <section className="card flex flex-col gap-3 border-accent p-4">
          <div>
            <h2 className="font-bold">先把同学和以前的旧账加进来</h2>
            <p className="text-sm text-muted">常一起花钱的同学先加上；如果之前就有没算清的账，顺便填上，面板会从这个数开始算。</p>
          </div>
          <AddContactForm
            submitLabel="添加，再加一个"
            onAdded={() => {
              setAddedCount((n) => n + 1);
              reload();
            }}
          />
          <button className="btn" onClick={finishOnboarding}>{addedCount ? `完成（已加 ${addedCount} 人）` : "跳过，以后再说"}</button>
        </section>
      )}

      {pending > 0 && (
        <Link href="/review" className="card flex items-center justify-between border-accent bg-accent-soft p-4">
          <span>
            还有 <b className="num">{pending}</b> 笔待确认
          </span>
          <span className="font-bold text-accent">去处理 ›</span>
        </Link>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="flex items-baseline justify-between text-sm text-muted">
          <span className="tracking-widest">每个人</span>
          {rows && rows.length > 0 && <span className="text-xs">点名字看明细、改还款</span>}
        </h2>
        {error && <p className="card p-4 text-sm text-danger">加载失败：{error}</p>}
        {rows ? <BalanceList rows={rows} /> : !error && <p className="text-sm text-muted">加载中…</p>}
      </section>

      <MonthlySpend />
    </main>
  );
}
