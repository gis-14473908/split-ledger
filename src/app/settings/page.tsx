"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AddContactForm } from "@/components/contacts/AddContactForm";
import { SourceSheet } from "@/components/settings/SourceSheet";
import { providerById } from "@/lib/ai/catalog";
import { MODEL_KEYS, MODEL_LABEL } from "@/lib/ai/models";
import type { AiSource, Contact, ModelKey, Profile } from "@/lib/db/types";
import { deleteSource, listSources, readQuota } from "@/lib/data/sources";
import { loadProfile, updateSettings } from "@/lib/data/settings";
import { createBrowserSupabase } from "@/lib/supabase/browser";

const MODEL_NOTE: Record<ModelKey, string> = {
  haiku: "最便宜、最快，约 £0.001/张，复杂小票偶尔要手动改",
  sonnet: "均衡，约 £0.02/张（默认）",
  opus: "最准，约 £0.04/张",
};

export default function SettingsPage() {
  const sb = createBrowserSupabase();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sources, setSources] = useState<AiSource[]>([]);
  const [quota, setQuota] = useState<{ usedMicro: number; grantedMicro: number } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [delBusy, setDelBusy] = useState(false);

  const refreshSources = useCallback(() => {
    listSources(sb).then(setSources).catch((e) => setError((e as Error).message));
  }, [sb]);

  useEffect(() => {
    loadProfile(sb)
      .then((p) => {
        setProfile(p);
        setName(p.display_name);
      })
      .catch((e) => setError((e as Error).message));
    sb.from("contacts")
      .select("*")
      .order("created_at")
      .then(({ data }) => setContacts((data ?? []) as Contact[]));
    refreshSources();
    readQuota(sb).then(setQuota).catch((e) => setError((e as Error).message));
  }, [sb, refreshSources]);

  async function save(patch: { displayName?: string; defaultModel?: ModelKey; defaultSource?: string }, message: string) {
    if (!profile) return;
    setError(null);
    try {
      await updateSettings(sb, profile.id, patch);
      setProfile({ ...profile, ...(patch.displayName ? { display_name: patch.displayName } : {}), ...(patch.defaultModel ? { default_model: patch.defaultModel } : {}), ...(patch.defaultSource ? { default_source: patch.defaultSource } : {}) });
      setSaved(message);
      setTimeout(() => setSaved(null), 1500);
    } catch (e) {
      setError(`保存失败：${(e as Error).message}`);
    }
  }

  const currentSource = profile ? (profile.default_source ?? `builtin:${profile.default_model}`) : null;
  const sourceOptions = [
    ...MODEL_KEYS.map((m) => ({ value: `builtin:${m}`, label: `内置 · ${MODEL_LABEL[m]}` })),
    ...sources.map((s) => ({ value: `custom:${s.id}`, label: s.label })),
  ];
  const total = quota ? (1_000_000 + quota.grantedMicro) / 1e6 : 0;
  const used = quota ? quota.usedMicro / 1e6 : 0;
  const pct = quota && total > 0 ? Math.min(100, (used / total) * 100) : 0;

  async function removeSource(id: string) {
    if (confirmDel !== id) return setConfirmDel(id);
    setDelBusy(true);
    setError(null);
    try {
      await deleteSource(sb, id);
      if (profile && profile.default_source === `custom:${id}`) {
        await save({ defaultSource: `builtin:${profile.default_model}` }, "默认源已切回内置");
      }
      setConfirmDel(null);
      refreshSources();
    } catch (e) {
      setError(`删除失败：${(e as Error).message}`);
    } finally {
      setDelBusy(false);
    }
  }

  async function logout() {
    await sb.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <main className="mx-auto flex max-w-[480px] flex-col gap-5 px-4 pt-6">
      <h1 className="font-display text-2xl font-extrabold">设置</h1>
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      {saved && <p className="text-sm text-ok" role="status">{saved}</p>}

      <section className="card flex flex-col gap-2 p-4">
        <label htmlFor="display-name" className="text-sm text-muted">昵称（同学会看到）</label>
        <div className="flex gap-2">
          <input id="display-name" className="field" maxLength={20} value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn shrink-0 py-2" disabled={!name.trim() || name === profile?.display_name} onClick={() => save({ displayName: name }, "昵称已保存")}>
            保存
          </button>
        </div>
      </section>

      <section className="card flex flex-col gap-2 p-4">
        <h2 className="text-sm text-muted">内置源用哪档</h2>
        {MODEL_KEYS.map((m) => (
          <label key={m} className={`flex cursor-pointer items-start gap-3 rounded-xl p-2 ${profile?.default_model === m ? "bg-accent-soft" : ""}`}>
            <input
              type="radio"
              name="model"
              id={`model-${m}`}
              className="mt-1 accent-[var(--accent)]"
              checked={profile?.default_model === m}
              onChange={() => save({ defaultModel: m }, `默认模型已改为 ${MODEL_LABEL[m]}`)}
            />
            <span>
              <b className="block">{MODEL_LABEL[m]}</b>
              <span className="text-xs text-muted">{MODEL_NOTE[m]}</span>
            </span>
          </label>
        ))}
        <p className="text-xs text-muted">识别不准时，在识别结果页可以随时用 Opus 5.5 重新识别。</p>
      </section>

      <section className="card flex flex-col gap-3 p-4">
        <h2 className="text-sm text-muted">AI 源</h2>
        {quota && (
          <div className="flex flex-col gap-1">
            <p className="num text-sm">已用 ${used.toFixed(2)} / ${total.toFixed(2)}</p>
            <div className="h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label="额度">
              <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}

        {sources.length > 0 && (
          <ul className="divide-y divide-line">
            {sources.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <b className="block truncate">{s.label}</b>
                  <span className="block truncate text-xs text-muted">{providerById(s.provider)?.label ?? s.provider} · <span className="num">••••{s.key_last4}</span></span>
                </span>
                <button className="shrink-0 text-xs text-danger" disabled={delBusy} onClick={() => removeSource(s.id)}>
                  {confirmDel === s.id ? "确认删除？" : "删除"}
                </button>
              </li>
            ))}
          </ul>
        )}

        <button className="btn py-2 text-sm" onClick={() => setSheetOpen(true)}>+ 添加源</button>

        <h3 className="text-sm text-muted">默认源</h3>
        {sourceOptions.map((o) => (
          <label key={o.value} className={`flex cursor-pointer items-center gap-3 rounded-xl p-2 ${currentSource === o.value ? "bg-accent-soft" : ""}`}>
            <input
              type="radio"
              name="default-source"
              className="accent-[var(--accent)]"
              checked={currentSource === o.value}
              onChange={() => save({ defaultSource: o.value }, `默认源已改为 ${o.label}`)}
            />
            <span>{o.label}</span>
          </label>
        ))}
      </section>

      <SourceSheet open={sheetOpen} onClose={() => setSheetOpen(false)} onSaved={refreshSources} />

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm tracking-widest text-muted">联系人</h2>
          <button className="text-sm text-accent" onClick={() => setAdding((v) => !v)}>{adding ? "收起" : "+ 添加联系人"}</button>
        </div>
        {adding && (
          <div className="card p-4">
            <AddContactForm onAdded={(c) => setContacts((list) => [...list, c])} />
          </div>
        )}
        {contacts.length === 0 ? (
          <p className="card p-4 text-sm text-muted">还没有联系人。可以在这里添加，分账时也能随手写名字。</p>
        ) : (
          <ul className="card divide-y divide-line">
            {contacts.map((c) => (
              <li key={c.id}>
                <Link href={`/contacts/${c.id}`} className="flex items-center justify-between px-4 py-3">
                  <span>{c.name}</span>
                  <span className="text-xs text-muted">{c.linked_user_id ? "已关联" : "未关联 · 可邀请"} ›</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <button className="btn text-danger" onClick={logout}>退出登录</button>
    </main>
  );
}
