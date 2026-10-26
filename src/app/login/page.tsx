"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthShell } from "@/components/AuthShell";
import { safeNext } from "@/lib/nav/safe-next";
import { createBrowserSupabase } from "@/lib/supabase/browser";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await createBrowserSupabase().auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      setError(error.message.includes("confirm") ? "邮箱还没验证，请先点确认邮件里的链接" : "邮箱或密码不对");
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <AuthShell title="登录">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          邮箱
          <input id="email" className="field" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          密码
          <input id="password" className="field" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        <button className="btn btn-primary mt-2" disabled={busy}>{busy ? "登录中…" : "登录"}</button>
      </form>
      <p className="text-sm text-muted">
        还没有账号？<Link className="text-accent" href={`/signup?next=${encodeURIComponent(next)}`}>注册</Link>
      </p>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
