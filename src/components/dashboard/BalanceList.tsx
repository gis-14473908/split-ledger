import Link from "next/link";
import type { BalanceRow } from "@/lib/data/dashboard";
import { formatPence } from "@/lib/money";

export function BalanceList({ rows }: { rows: BalanceRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="card p-4 text-sm text-muted">
        还没有分账记录。导入账单后，把和同学一起花的那几笔右滑成“一起的”，就会出现在这里。
      </p>
    );
  }
  return (
    <ul className="card divide-y divide-line">
      {rows.map(({ contact, pence }) => (
        <li key={contact.id}>
          <Link href={`/contacts/${contact.id}`} className="flex items-center gap-3 px-4 py-3.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft font-bold text-accent">
              {contact.name.slice(0, 1)}
            </span>
            <span className="min-w-0 flex-1 truncate font-semibold">{contact.name}</span>
            {pence > 0 && (
              <span className="text-right">
                <span className="block text-xs text-muted">欠你</span>
                <span className="num text-lg text-accent">{formatPence(pence)}</span>
              </span>
            )}
            {pence < 0 && (
              <span className="text-right">
                <span className="block text-xs text-muted">你欠 TA</span>
                <span className="num text-lg text-later">{formatPence(-pence)}</span>
              </span>
            )}
            {pence === 0 && <span className="text-sm text-muted">两清</span>}
            <span className="text-muted" aria-hidden>›</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
