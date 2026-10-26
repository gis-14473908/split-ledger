"use client";

import Link from "next/link";
import { useState } from "react";
import { AuthShell } from "@/components/AuthShell";
import { createBrowserSupabase } from "@/lib/supabase/browser";

export default function ForgotPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await createBrowserSupabase().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${location.origin}/auth/callback?next=/reset-password`,
    });
    setBusy(false);
    if (error) {
      setError(error.message.includes("rate") ? "发送太频繁了，请过几分钟再试" : `发送失败：${error.message}`);
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <AuthShell title="查收邮件">
        <p>如果 <b>{email}</b> 注册过，重置密码的邮件已经发出。请在<b>这个浏览器</b>里点开邮件中的链接，然后设置新密码。</p>
        <p className="text-sm text-muted">没收到的话看看垃圾邮件文件夹，或者过几分钟再试。</p>
        <Link className="btn" href="/login">回到登录</Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="忘记密码">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          注册时用的邮箱
          <input id="email" className="field" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        <button className="btn btn-primary mt-2" disabled={busy}>{busy ? "发送中…" : "发送重置邮件"}</button>
      </form>
      <p className="text-sm text-muted">
        想起来了？<Link className="text-accent" href="/login">回到登录</Link>
      </p>
    </AuthShell>
  );
}
