"use client";

import { useEffect, useRef, useState } from "react";
import type { Category } from "@/lib/categories";
import type { ReviewItem } from "@/lib/data/review";
import { TxCard } from "./TxCard";

export type SwipeAction = "personal" | "later" | "share";

const THRESHOLD = 100;

/**
 * Stacked cards. Left = only mine, right = shared (opens the split sheet), up = later.
 * onAction resolves to false when saving failed, which sends the card back to the middle.
 */
export function SwipeDeck({
  stack,
  onAction,
  onCategory,
}: {
  stack: ReviewItem[]; // current card first
  onAction: (action: SwipeAction) => Promise<boolean>;
  onCategory: (c: Category) => void;
}) {
  const top = useRef<HTMLDivElement>(null);
  const drag = useRef({ active: false, x: 0, y: 0, dx: 0, dy: 0 });
  const [offset, setOffset] = useState({ dx: 0, dy: 0, flying: false });
  const currentId = stack[0]?.id;

  useEffect(() => setOffset({ dx: 0, dy: 0, flying: false }), [currentId]);

  async function act(action: SwipeAction) {
    if (action === "share") {
      setOffset({ dx: 0, dy: 0, flying: false });
      await onAction("share");
      return;
    }
    setOffset({ dx: action === "personal" ? -520 : 0, dy: action === "later" ? -700 : 40, flying: true });
    const ok = await onAction(action);
    if (!ok) setOffset({ dx: 0, dy: 0, flying: false });
  }

  function onPointerDown(e: React.PointerEvent) {
    drag.current = { active: true, x: e.clientX, y: e.clientY, dx: 0, dy: 0 };
    top.current?.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current.active) return;
    drag.current.dx = e.clientX - drag.current.x;
    drag.current.dy = e.clientY - drag.current.y;
    setOffset({ dx: drag.current.dx, dy: drag.current.dy, flying: false });
  }
  function onPointerUp() {
    if (!drag.current.active) return;
    drag.current.active = false;
    const { dx, dy } = drag.current;
    if (dx > THRESHOLD) act("share");
    else if (dx < -THRESHOLD) act("personal");
    else if (dy < -THRESHOLD && Math.abs(dx) < 80) act("later");
    else setOffset({ dx: 0, dy: 0, flying: false });
  }

  const dragging = drag.current.active;
  const stamp = (v: number) => Math.max(0, Math.min(1, v / 90));

  return (
    <div className="flex flex-1 flex-col">
      <div className="relative z-0 mx-4 mt-3 flex-1">
        {stack
          .slice(0, 3)
          .map((item, depth) => ({ item, depth }))
          .reverse()
          .map(({ item, depth }) => {
            const isTop = depth === 0;
            const style: React.CSSProperties = isTop
              ? {
                  transform: `translate(${offset.dx}px, ${offset.dy}px) rotate(${offset.dx / 18}deg)`,
                  opacity: offset.flying ? 0 : 1,
                  transition: dragging ? "none" : "transform .25s ease, opacity .25s ease",
                  touchAction: "none",
                  zIndex: 10,
                }
              : { transform: `translateY(${depth * 12}px) scale(${1 - depth * 0.05})`, zIndex: 10 - depth, opacity: depth > 1 ? 0.7 : 1 };
            return (
              <div
                key={item.id}
                ref={isTop ? top : undefined}
                className="card absolute inset-x-0 top-0 flex h-[min(470px,calc(100dvh-330px))] min-h-[360px] flex-col overflow-hidden p-4 shadow-[var(--shadow)] select-none"
                style={style}
                onPointerDown={isTop ? onPointerDown : undefined}
                onPointerMove={isTop ? onPointerMove : undefined}
                onPointerUp={isTop ? onPointerUp : undefined}
                onPointerCancel={isTop ? onPointerUp : undefined}
                aria-hidden={!isTop}
              >
                {isTop && (
                  <>
                    <Stamp className="top-5 left-5 -rotate-10 text-accent" opacity={stamp(offset.dx)}>一起的</Stamp>
                    <Stamp className="top-5 right-5 rotate-10 text-mine" opacity={stamp(-offset.dx)}>自己的</Stamp>
                    <Stamp
                      className="bottom-6 left-1/2 -translate-x-1/2 text-later"
                      opacity={Math.abs(offset.dx) < 60 ? stamp(-offset.dy) : 0}
                    >
                      稍后
                    </Stamp>
                  </>
                )}
                <TxCard item={item} onCategory={isTop ? onCategory : undefined} />
              </div>
            );
          })}
      </div>

      <div className="flex justify-center gap-4 px-4 pt-2 pb-4">
        <ActionButton label="只是我的" onClick={() => act("personal")}>自己</ActionButton>
        <ActionButton label="先跳过" onClick={() => act("later")} tone="later">稍后</ActionButton>
        <ActionButton label="分账" onClick={() => act("share")} tone="share">一起</ActionButton>
      </div>
    </div>
  );
}

function Stamp({ className, opacity, children }: { className: string; opacity: number; children: React.ReactNode }) {
  return (
    <span
      className={`font-display pointer-events-none absolute z-10 rounded-lg border-[3px] border-current bg-surface px-3 py-0.5 text-xl font-extrabold ${className}`}
      style={{ opacity }}
    >
      {children}
    </span>
  );
}

function ActionButton({
  label,
  onClick,
  tone,
  children,
}: {
  label: string;
  onClick: () => void;
  tone?: "later" | "share";
  children: React.ReactNode;
}) {
  const circle =
    tone === "share"
      ? "size-14 border-accent bg-accent text-white"
      : `size-12 border-line bg-surface ${tone === "later" ? "text-later" : "text-ink"}`;
  return (
    <button type="button" onClick={onClick} className="flex flex-col items-center gap-1 text-[13px] text-muted">
      <span className={`grid place-items-center rounded-full border font-bold shadow-[var(--shadow)] ${circle}`}>{children}</span>
      {label}
    </button>
  );
}
