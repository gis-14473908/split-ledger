"use client";

import Link from "next/link";
import { useState } from "react";
import { AuthShell } from "@/components/AuthShell";
import { validateNewPassword } from "@/lib/auth/password";
import { createBrowserSupabase } from "@/lib/supabase/browser";

// Reached from the reset email via /auth/callback, which has already signed the user in.
export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const problem = validateNewPassword(password, confirm);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    const { error } = await createBrowserSupabase().auth.updateUser({ password });
    setBusy(false);
    if (error) {
      setError(error.message.includes("different") ? "新密码不能和旧密码一样" : `修改失败：${error.message}`);
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <AuthShell title="密码已更新">
        <p>以后用新密码登录就行。</p>
        <Link className="btn btn-primary" href="/">进入分账本</Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="设置新密码">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          新密码（至少 6 位）
          <input id="password" className="field" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          再输一次
          <input id="confirm" className="field" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        <button className="btn btn-primary mt-2" disabled={busy}>{busy ? "保存中…" : "保存新密码"}</button>
      </form>
    </AuthShell>
  );
}
