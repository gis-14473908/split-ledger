"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { BANK_LABEL } from "@/lib/banks";
import { CATEGORIES, CATEGORY_COLOR, CATEGORY_LABEL, type Category } from "@/lib/categories";
import type { ReviewItem } from "@/lib/data/review";
import { formatCnDate, weekdayCn } from "@/lib/dates";
import { formatPence } from "@/lib/money";
import { dayWindow } from "@/lib/review/day-window";

const DAY_ROWS = 6;

export function TxCard({ item, onCategory }: { item: ReviewItem; onCategory?: (c: Category) => void }) {
  const [picking, setPicking] = useState(false);
  const [showDay, setShowDay] = useState(false);
  const day = dayWindow(item.sameDay, DAY_ROWS);
  const stop = (e: React.PointerEvent) => e.stopPropagation();
  const time = item.occurred_at_time?.slice(0, 5);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="num rounded-md bg-accent-soft px-2 py-0.5 text-xs tracking-wider text-accent uppercase">
          {BANK_LABEL[item.bank]}
        </span>
        <span className="num text-[13px] text-muted">
          {weekdayCn(item.occurred_on)} {formatCnDate(item.occurred_on)}
          {time ? ` · ${time}` : ""}
        </span>
      </div>

      <div>
        <p className="font-display text-2xl leading-tight font-bold break-words">{item.merchant}</p>
        {item.location && <p className="mt-0.5 text-[13px] text-muted">{item.location}</p>}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="num text-4xl tracking-tight">{formatPence(item.amount_pence)}</p>
        <div className="relative">
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-full border border-dashed border-line px-3 py-1 text-sm"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onCategory && setPicking((v) => !v)}
            aria-expanded={picking}
          >
            <span className="size-2.5 rounded-full" style={{ background: CATEGORY_COLOR[item.category] }} />
            {CATEGORY_LABEL[item.category]}
            {onCategory && <span className="text-muted">· 可改</span>}
          </button>
          {picking && onCategory && (
            <ul
              className="card absolute right-0 z-20 mt-1 grid w-44 grid-cols-2 gap-1 p-2 shadow-[var(--shadow)]"
              onPointerDown={(e) => e.stopPropagation()}
            >
              {CATEGORIES.filter((c) => c !== "transfer").map((c) => (
                <li key={c}>
                  <button
                    type="button"
                    className={`w-full rounded-lg px-2 py-1.5 text-left text-sm ${c === item.category ? "bg-accent-soft text-accent" : ""}`}
                    onClick={() => {
                      setPicking(false);
                      onCategory(c);
                    }}
                  >
                    {CATEGORY_LABEL[c]}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {(item.hint || item.original_amount != null) && (
        <div className="rounded-xl bg-accent-soft px-3 py-2 text-[13px]">
          {item.original_amount != null && (
            <span className="num mr-1">
              入账 {item.original_currency === "CNY" ? "¥" : `${item.original_currency} `}
              {Number(item.original_amount).toFixed(2)}
              {item.hint ? " · " : ""}
            </span>
          )}
          {item.hint}
        </div>
      )}

      {item.sameDay.length > 1 && (
        <div className="mt-auto flex flex-col gap-1 border-t border-line pt-2.5">
          <div className="flex items-baseline justify-between">
            <p className="text-xs tracking-widest text-muted">当天的消费（{item.sameDay.length} 笔）</p>
            {(day.hiddenBefore > 0 || day.hiddenAfter > 0) && (
              <button type="button" className="text-xs text-accent" onPointerDown={stop} onClick={() => setShowDay(true)}>
                查看全部
              </button>
            )}
          </div>
          {day.hiddenBefore > 0 && <p className="text-xs text-muted">↑ 前面还有 {day.hiddenBefore} 笔</p>}
          {day.rows.map((d, i) => <DayRow key={i} d={d} />)}
          {day.hiddenAfter > 0 && <p className="text-xs text-muted">↓ 后面还有 {day.hiddenAfter} 笔</p>}
        </div>
      )}

      {showDay &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setShowDay(false)} aria-hidden />
            <div
              role="dialog"
              aria-label="当天的全部消费"
              className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[80dvh] max-w-[480px] flex-col gap-2 overflow-y-auto rounded-t-3xl bg-surface px-5 pt-3"
              style={{ paddingBottom: "calc(20px + env(safe-area-inset-bottom, 0px))" }}
            >
              <div className="mx-auto h-1.5 w-10 rounded-full bg-line" />
              <h2 className="font-bold">
                {weekdayCn(item.occurred_on)} {formatCnDate(item.occurred_on)} · {item.sameDay.length} 笔
              </h2>
              {item.sameDay.map((d, i) => <DayRow key={i} d={d} />)}
              <button type="button" className="btn mt-2" onClick={() => setShowDay(false)}>关闭</button>
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}

function DayRow({ d }: { d: { time: string | null; merchant: string; amountPence: number; isCurrent: boolean } }) {
  return (
    <div className={`grid grid-cols-[44px_1fr_auto] gap-2 text-[13px] ${d.isCurrent ? "font-bold text-ink" : "text-muted"}`}>
      <span className="num text-xs">{d.time ?? "—"}</span>
      <span className="truncate">
        {d.isCurrent && <span className="text-accent">▸ </span>}
        {d.merchant}
      </span>
      <span className="num text-xs">{formatPence(d.amountPence)}</span>
    </div>
  );
}
