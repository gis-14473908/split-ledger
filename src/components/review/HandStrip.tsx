"use client";

import { useEffect, useRef } from "react";
import type { ReviewItem } from "@/lib/data/review";
import { formatPence } from "@/lib/money";
import type { Choice } from "@/lib/review/queue";

const TAG: Record<Choice, { label: string; className: string }> = {
  personal: { label: "自己", className: "bg-mine" },
  shared: { label: "一起", className: "bg-accent" },
  later: { label: "稍后", className: "bg-later" },
};

/** The row of small cards above the deck: progress at a glance, tap to jump. */
export function HandStrip({
  items,
  currentId,
  decided,
  onJump,
}: {
  items: ReviewItem[];
  currentId: string | null;
  decided: Record<string, Choice>;
  onJump: (id: string) => void;
}) {
  const row = useRef<HTMLDivElement>(null);

  useEffect(() => {
    row.current?.querySelector('[data-current="true"]')?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [currentId]);

  return (
    <div ref={row} className="flex gap-2 overflow-x-auto px-4 pt-3 pb-1 [scrollbar-width:none]">
      {items.map((it) => {
        const d = decided[it.id];
        const current = it.id === currentId;
        return (
          <button
            key={it.id}
            type="button"
            data-current={current}
            onClick={() => onJump(it.id)}
            className={`relative flex h-[84px] w-[72px] shrink-0 flex-col justify-between rounded-xl border bg-surface p-2 text-left text-[11px] transition-transform ${
              current ? "-translate-y-1 border-2 border-accent" : "border-line"
            } ${d && d !== "later" ? "opacity-45" : ""}`}
            aria-label={`${it.merchant} ${formatPence(it.amount_pence)}${d ? `，已选${TAG[d].label}` : ""}`}
          >
            {d && (
              <span className={`absolute -top-1.5 -right-1 rounded-md px-1.5 text-[10px] text-white ${TAG[d].className}`}>
                {TAG[d].label}
              </span>
            )}
            <span className="line-clamp-2" style={{ overflowWrap: "anywhere" }}>{it.merchant}</span>
            <b className="num text-[12px] font-medium">{formatPence(it.amount_pence)}</b>
          </button>
        );
      })}
    </div>
  );
}
