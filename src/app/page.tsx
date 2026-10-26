"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BalanceList } from "@/components/dashboard/BalanceList";
import { MonthlySpend } from "@/components/dashboard/MonthlySpend";
import { loadBalances, type BalanceRow } from "@/lib/data/dashboard";
import { formatPence } from "@/lib/money";
import { createBrowserSupabase } from "@/lib/supabase/browser";

export default function Dashboard() {
  const [rows, setRows] = useState<BalanceRow[] | null>(null);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sb = createBrowserSupabase();
    loadBalances(sb)
      .then(setRows)
      .catch((e) => setError((e as Error).message));
    sb.from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .then(({ count }) => setPending(count ?? 0));
  }, []);

  const owedToMe = rows?.reduce((s, r) => s + Math.max(0, r.pence), 0) ?? 0;

  return (
    <main className="mx-auto flex max-w-[480px] flex-col gap-5 px-4 pt-6">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted">同学一共欠你</p>
        <p className="num text-5xl tracking-tight">{rows ? formatPence(owedToMe) : "—"}</p>
      </header>

      {pending > 0 && (
        <Link href="/review" className="card flex items-center justify-between border-accent bg-accent-soft p-4">
          <span>
            还有 <b className="num">{pending}</b> 笔待确认
          </span>
          <span className="font-bold text-accent">去处理 ›</span>
        </Link>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm tracking-widest text-muted">每个人</h2>
        {error && <p className="card p-4 text-sm text-danger">加载失败：{error}</p>}
        {rows ? <BalanceList rows={rows} /> : !error && <p className="text-sm text-muted">加载中…</p>}
      </section>

      <MonthlySpend />
    </main>
  );
}
