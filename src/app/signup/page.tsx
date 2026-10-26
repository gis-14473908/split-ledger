"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthShell } from "@/components/AuthShell";
import { safeNext } from "@/lib/nav/safe-next";
import { createBrowserSupabase } from "@/lib/supabase/browser";

function SignupForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) return setError("密码至少 6 位");
    setBusy(true);
    setError(null);
    const { data, error } = await createBrowserSupabase().auth.signUp({
      email,
      password,
      options: {
        data: { display_name: name.trim() },
        emailRedirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    setBusy(false);
    if (error) {
      setError(error.message.includes("registered") ? "这个邮箱已经注册过了，直接登录吧" : `注册失败：${error.message}`);
      return;
    }
    if (data.session) {
      router.replace(next);
      router.refresh();
    } else {
      setSentTo(email);
    }
  }

  if (sentTo) {
    return (
      <AuthShell title="查收邮件">
        <p>确认邮件已发到 <b>{sentTo}</b>，点邮件里的链接就能登录。</p>
        <p className="text-sm text-muted">没收到的话看看垃圾邮件文件夹。</p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="注册">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          昵称（同学会看到这个名字）
          <input id="name" className="field" required maxLength={20} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          邮箱
          <input id="email" className="field" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          密码（至少 6 位）
          <input id="password" className="field" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        <button className="btn btn-primary mt-2" disabled={busy}>{busy ? "注册中…" : "注册"}</button>
      </form>
      <p className="text-sm text-muted">
        已有账号？<Link className="text-accent" href={`/login?next=${encodeURIComponent(next)}`}>登录</Link>
      </p>
    </AuthShell>
  );
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}
