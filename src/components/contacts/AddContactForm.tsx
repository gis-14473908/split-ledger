"use client";

import { useState } from "react";
import { addContact, type OpeningBalance } from "@/lib/data/contacts";
import type { Contact } from "@/lib/db/types";
import { formatPence, parsePounds } from "@/lib/money";
import { createBrowserSupabase } from "@/lib/supabase/browser";

/** Name plus an optional debt from before the app. Clears itself after each add. */
export function AddContactForm({ onAdded, submitLabel = "添加" }: { onAdded: (c: Contact) => void; submitLabel?: string }) {
  const [name, setName] = useState("");
  const [direction, setDirection] = useState<OpeningBalance["direction"]>("theyOwe");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const pence = amount.trim() ? parsePounds(amount) : 0;
    if (pence === null || pence < 0) return setError("金额格式不对，例如 12.50");
    setBusy(true);
    setError(null);
    try {
      const c = await addContact(createBrowserSupabase(), name, { direction, pence });
      setAdded(pence ? `已添加 ${c.name}（${direction === "theyOwe" ? "TA 欠你" : "你欠 TA"} ${formatPence(pence)}）` : `已添加 ${c.name}`);
      setName("");
      setAmount("");
      setDirection("theyOwe");
      onAdded(c);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <input
        id="contact-name"
        className="field"
        placeholder="同学的名字"
        maxLength={20}
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <div>
        <p className="mb-1.5 text-xs text-muted">以前的旧账（没有就留空）</p>
        <div className="grid grid-cols-[1fr_1fr_110px] gap-2">
          {(["theyOwe", "iOwe"] as const).map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={direction === d}
              onClick={() => setDirection(d)}
              className={`rounded-xl px-2 py-2 text-sm ${direction === d ? "border-2 border-accent bg-accent-soft text-accent" : "border border-line bg-surface"}`}
            >
              {d === "theyOwe" ? "TA 欠我" : "我欠 TA"}
            </button>
          ))}
          <input
            id="contact-opening"
            className="field num"
            inputMode="decimal"
            placeholder="£0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-label="旧账金额"
          />
        </div>
      </div>
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      {added && !error && <p className="text-sm text-ok" role="status">{added}</p>}
      <button className="btn btn-primary" disabled={busy || !name.trim()}>{busy ? "保存中…" : submitLabel}</button>
    </form>
  );
}
