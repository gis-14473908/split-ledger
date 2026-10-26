"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PENDING_CHANGED } from "@/components/BottomNav";
import { HandStrip } from "@/components/review/HandStrip";
import { ReceiptAssigner } from "@/components/review/ReceiptAssigner";
import { SplitSheet } from "@/components/review/SplitSheet";
import { SwipeDeck, type SwipeAction } from "@/components/review/SwipeDeck";
import type { Category } from "@/lib/categories";
import {
  createContact,
  loadReviewData,
  resetTx,
  saveLater,
  savePersonal,
  saveShares,
  updateCategory,
  type ReviewItem,
} from "@/lib/data/review";
import type { Contact } from "@/lib/db/types";
import { decide, initQueue, jump, undo, type Choice, type QueueState } from "@/lib/review/queue";
import type { Share } from "@/lib/split/equal";
import { createBrowserSupabase } from "@/lib/supabase/browser";

export default function ReviewPage() {
  const sb = createBrowserSupabase();
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [q, setQ] = useState<QueueState>(initQueue([]));
  const [sharing, setSharing] = useState<ReviewItem | null>(null);
  const [receiptFor, setReceiptFor] = useState<{ item: ReviewItem; people: { includeMe: boolean; contactIds: string[] } } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    loadReviewData(sb)
      .then(({ items, contacts }) => {
        setItems(items);
        setContacts(contacts);
        setQ(initQueue(items.map((i) => i.id)));
      })
      .catch((e) => setLoadError((e as Error).message));
  }, [sb]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1600);
    return () => clearTimeout(t);
  }, [toast]);

  const byId = useMemo(() => new Map((items ?? []).map((i) => [i.id, i])), [items]);
  const stack = useMemo(() => {
    if (!q.currentId) return [];
    return [q.currentId, ...q.order.filter((id) => id !== q.currentId)].flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  }, [q, byId]);

  const record = useCallback((id: string, choice: Choice, message: string) => {
    setQ((s) => decide(s, id, choice));
    setToast(message);
    window.dispatchEvent(new Event(PENDING_CHANGED));
  }, []);

  async function onAction(action: SwipeAction): Promise<boolean> {
    const current = q.currentId ? byId.get(q.currentId) : undefined;
    if (!current) return false;
    if (action === "share") {
      setSharing(current);
      return true;
    }
    try {
      if (action === "personal") await savePersonal(sb, current.id);
      else await saveLater(sb, current.id);
      record(current.id, action, action === "personal" ? "已归为个人消费" : "放到最后了");
      return true;
    } catch {
      setToast("保存失败，请重试");
      return false;
    }
  }

  async function onEqual(shares: Share[]) {
    if (!sharing) return;
    await saveShares(sb, sharing.id, shares);
    record(sharing.id, "shared", "已分账");
    setSharing(null);
  }

  async function onReceiptDone(shares: Share[]) {
    if (!receiptFor) return;
    await saveShares(sb, receiptFor.item.id, shares);
    record(receiptFor.item.id, "shared", "已按小票分账");
    setReceiptFor(null);
  }

  async function onUndo() {
    const { state, undone } = undo(q);
    if (!undone) return;
    try {
      await resetTx(sb, undone.id);
      setQ(state);
      window.dispatchEvent(new Event(PENDING_CHANGED));
      setToast("已撤销");
    } catch {
      setToast("撤销失败，请重试");
    }
  }

  async function onJump(id: string) {
    const d = q.decided[id];
    if (d && d !== "later") {
      try {
        await resetTx(sb, id);
        setToast("已放回队列，可以重新选");
      } catch {
        return setToast("操作失败，请重试");
      }
    }
    setQ((s) => jump(s, id));
  }

  async function onCategory(c: Category) {
    const id = q.currentId;
    if (!id) return;
    try {
      await updateCategory(sb, id, c);
      setItems((list) => list?.map((i) => (i.id === id ? { ...i, category: c } : i)) ?? null);
    } catch {
      setToast("改分类失败，请重试");
    }
  }

  async function onCreateContact(name: string) {
    const c = await createContact(sb, name);
    setContacts((list) => [...list, c]);
    return c;
  }

  const total = items?.length ?? 0;
  const left = q.order.length;
  const counts = Object.values(q.decided).reduce<Record<string, number>>((m, c) => ((m[c] = (m[c] ?? 0) + 1), m), {});

  return (
    <main className="mx-auto flex min-h-[calc(100dvh-6rem)] max-w-[480px] flex-col">
      <header className="flex items-center justify-between px-4 pt-5">
        <h1 className="text-lg font-bold">待处理账单</h1>
        <span className="num text-[13px] text-muted">{items ? (left ? `剩 ${left} / ${total} 笔` : "全部完成") : ""}</span>
        <button className="text-sm text-accent disabled:text-line" disabled={q.history.length === 0} onClick={onUndo}>
          撤销
        </button>
      </header>

      {loadError && <p className="card m-4 p-4 text-sm text-danger">加载失败：{loadError}</p>}
      {!items && !loadError && <p className="p-8 text-center text-muted">加载中…</p>}

      {items && total === 0 && (
        <div className="m-auto flex flex-col items-center gap-3 p-8 text-center">
          <p className="font-display text-2xl font-extrabold">没有待处理的账单</p>
          <p className="text-muted">先导入一些银行截图吧。</p>
          <Link href="/import" className="btn btn-primary">去导入</Link>
        </div>
      )}

      {items && total > 0 && (
        <>
          <HandStrip items={items} currentId={q.currentId} decided={q.decided} onJump={onJump} />
          {stack.length > 0 ? (
            <SwipeDeck stack={stack} onAction={onAction} onCategory={onCategory} />
          ) : (
            <div className="m-auto flex flex-col items-center gap-3 p-8 text-center">
              <p className="font-display text-2xl font-extrabold">都处理完了</p>
              <p className="text-muted">
                自己的 {counts.personal ?? 0} 笔 · 一起的 {counts.shared ?? 0} 笔 · 稍后 {counts.later ?? 0} 笔
              </p>
              <Link href="/" className="btn btn-primary">看看谁欠我钱</Link>
            </div>
          )}
        </>
      )}

      {toast && (
        <div className="pointer-events-none fixed top-16 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-ink px-4 py-1.5 text-[13px] whitespace-nowrap text-bg">
          {toast}
        </div>
      )}

      {sharing && (
        <SplitSheet
          target={{ id: sharing.id, merchant: sharing.merchant, amountPence: sharing.amount_pence }}
          contacts={contacts}
          onCreateContact={onCreateContact}
          onCancel={() => setSharing(null)}
          onEqual={onEqual}
          onReceipt={(people) => {
            setReceiptFor({ item: sharing, people });
            setSharing(null);
          }}
        />
      )}

      {receiptFor && (
        <ReceiptAssigner
          target={{ id: receiptFor.item.id, merchant: receiptFor.item.merchant, amountPence: receiptFor.item.amount_pence }}
          people={receiptFor.people}
          contacts={contacts}
          onCancel={() => setReceiptFor(null)}
          onDone={onReceiptDone}
        />
      )}
    </main>
  );
}
