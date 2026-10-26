"use client";

import { BANK_LABEL } from "@/lib/banks";
import { CATEGORIES, CATEGORY_LABEL, type Category } from "@/lib/categories";
import type { ImportedTransaction } from "@/lib/ai/schemas";
import { formatPence, parsePounds } from "@/lib/money";

export type PreviewRow = ImportedTransaction & { key: string; duplicate: boolean; include: boolean };

export function PreviewList({ rows, onChange }: { rows: PreviewRow[]; onChange: (rows: PreviewRow[]) => void }) {
  const update = (key: string, patch: Partial<PreviewRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <ul className="flex flex-col gap-3">
      {rows.map((r) => (
        <li key={r.key} className={`card flex flex-col gap-2 p-3 ${r.include ? "" : "opacity-60"}`}>
          <div className="flex items-center gap-2">
            <input
              id={`inc-${r.key}`}
              type="checkbox"
              className="size-5 accent-[var(--accent)]"
              checked={r.include}
              onChange={(e) => update(r.key, { include: e.target.checked })}
              aria-label="导入这一笔"
            />
            <span className="num rounded-md bg-accent-soft px-2 py-0.5 text-xs text-accent">{BANK_LABEL[r.bank]}</span>
            {r.duplicate && <span className="rounded-md bg-later/15 px-2 py-0.5 text-xs text-later">可能重复</span>}
            {r.status === "transfer" && (
              <span className="rounded-md bg-line/60 px-2 py-0.5 text-xs text-muted">转账/收入，不参与分账</span>
            )}
            <button
              className="ml-auto text-sm text-muted"
              onClick={() => onChange(rows.filter((x) => x.key !== r.key))}
              aria-label={`删除 ${r.merchant}`}
            >
              删除
            </button>
          </div>
          <input
            id={`m-${r.key}`}
            className="field font-semibold"
            value={r.merchant}
            onChange={(e) => update(r.key, { merchant: e.target.value })}
            aria-label="商家"
          />
          <div className="grid grid-cols-[1fr_1fr] gap-2">
            <input
              id={`d-${r.key}`}
              className="field num"
              type="date"
              value={r.occurredOn}
              onChange={(e) => e.target.value && update(r.key, { occurredOn: e.target.value })}
              aria-label="日期"
            />
            <AmountInput
              id={`a-${r.key}`}
              pence={r.amountPence}
              onChange={(amountPence) =>
                update(r.key, {
                  amountPence,
                  status: amountPence < 0 ? "transfer" : r.isTransfer ? "transfer" : "pending",
                })
              }
            />
          </div>
          <select
            id={`c-${r.key}`}
            className="field"
            value={r.category ?? "other"}
            onChange={(e) => {
              const category = e.target.value as Category;
              update(r.key, {
                category,
                isTransfer: category === "transfer",
                status: category === "transfer" || r.amountPence < 0 ? "transfer" : "pending",
              });
            }}
            aria-label="分类"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
          {r.originalAmount != null && (
            <p className="num text-xs text-muted">
              原币 {r.originalCurrency} {r.originalAmount.toFixed(2)}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

function AmountInput({ id, pence, onChange }: { id: string; pence: number; onChange: (pence: number) => void }) {
  return (
    <input
      id={id}
      key={pence}
      className="field num"
      inputMode="decimal"
      defaultValue={(pence / 100).toFixed(2)}
      onBlur={(e) => {
        const v = parsePounds(e.target.value);
        if (v === null) e.target.value = (pence / 100).toFixed(2);
        else if (v !== pence) onChange(v);
      }}
      aria-label={`金额，当前 ${formatPence(pence)}`}
    />
  );
}
