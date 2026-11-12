"use client";

import { useState } from "react";
import { PROVIDERS, providerById } from "@/lib/ai/catalog";
import { addSource } from "@/lib/data/sources";
import { createBrowserSupabase } from "@/lib/supabase/browser";

const OTHER = "__other__";

/** Bottom sheet to add one custom AI source (provider + model + own API key). */
export function SourceSheet({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const sb = createBrowserSupabase();
  const [provider, setProvider] = useState(PROVIDERS[0].id);
  const [modelChoice, setModelChoice] = useState(PROVIDERS[0].suggestedModels[0]?.id ?? OTHER);
  const [customModel, setCustomModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const def = providerById(provider) ?? PROVIDERS[0];
  const model = modelChoice === OTHER ? customModel.trim() : modelChoice;
  const canSave = !busy && label.trim() !== "" && model !== "" && apiKey.trim() !== "";

  function pickProvider(id: string) {
    setProvider(id);
    setModelChoice(providerById(id)?.suggestedModels[0]?.id ?? OTHER);
    setCustomModel("");
  }

  async function save() {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await sb.auth.getUser();
      if (!data.user) throw new Error("请先登录");
      await addSource(sb, data.user.id, { label, provider, model, apiKey });
      setProvider(PROVIDERS[0].id);
      setModelChoice(PROVIDERS[0].suggestedModels[0]?.id ?? OTHER);
      setCustomModel("");
      setApiKey("");
      setLabel("");
      setBusy(false);
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-label="添加 AI 源"
        className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[88dvh] max-w-[480px] flex-col gap-3 overflow-y-auto rounded-t-3xl bg-surface px-5 pt-2.5"
        style={{ paddingBottom: "calc(20px + env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="mx-auto h-1.5 w-10 rounded-full bg-line" />
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">添加 AI 源</h3>
          <button className="text-sm text-muted" onClick={onClose}>关闭</button>
        </div>

        <label htmlFor="src-provider" className="text-sm text-muted">供应商</label>
        <select id="src-provider" className="field" value={provider} onChange={(e) => pickProvider(e.target.value)}>
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>

        <label htmlFor="src-model" className="text-sm text-muted">模型</label>
        <select id="src-model" className="field" value={modelChoice} onChange={(e) => setModelChoice(e.target.value)}>
          {def.suggestedModels.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
          <option value={OTHER}>其他…</option>
        </select>
        {modelChoice === OTHER && (
          <input
            id="src-model-custom"
            className="field"
            placeholder="手填模型名"
            aria-label="手填模型名"
            value={customModel}
            onChange={(e) => setCustomModel(e.target.value)}
          />
        )}
        <p className="-mt-1 text-xs text-muted">请填支持图片识别的模型</p>

        <label htmlFor="src-key" className="text-sm text-muted">API Key</label>
        <input
          id="src-key"
          className="field num"
          type="password"
          autoComplete="off"
          placeholder="sk-…"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
        <p className="-mt-1 text-xs text-muted">{def.keyHint}</p>

        <label htmlFor="src-label" className="text-sm text-muted">名字</label>
        <input
          id="src-label"
          className="field"
          maxLength={30}
          placeholder="例如：我的 Gemini"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />

        {error && <p className="text-sm text-danger" role="alert">{error}</p>}

        <button className="btn btn-primary" disabled={!canSave} onClick={save}>
          {busy ? "保存中…" : "保存"}
        </button>
      </div>
    </>
  );
}
