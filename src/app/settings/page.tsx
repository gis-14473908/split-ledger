"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { MODEL_KEYS, MODEL_LABEL } from "@/lib/ai/models";
import type { Contact, ModelKey, Profile } from "@/lib/db/types";
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
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  }, [sb]);

  async function save(patch: { displayName?: string; defaultModel?: ModelKey }, message: string) {
    if (!profile) return;
    setError(null);
    try {
      await updateSettings(sb, profile.id, patch);
      setProfile({ ...profile, ...(patch.displayName ? { display_name: patch.displayName } : {}), ...(patch.defaultModel ? { default_model: patch.defaultModel } : {}) });
      setSaved(message);
      setTimeout(() => setSaved(null), 1500);
    } catch (e) {
      setError(`保存失败：${(e as Error).message}`);
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
        <h2 className="text-sm text-muted">默认识别模型</h2>
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

      <section className="flex flex-col gap-2">
        <h2 className="text-sm tracking-widest text-muted">联系人</h2>
        {contacts.length === 0 ? (
          <p className="card p-4 text-sm text-muted">分账时添加的同学会出现在这里。</p>
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
