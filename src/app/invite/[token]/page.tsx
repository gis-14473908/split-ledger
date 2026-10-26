"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { AuthShell } from "@/components/AuthShell";
import { acceptInvite } from "@/lib/data/dashboard";
import { createBrowserSupabase } from "@/lib/supabase/browser";

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const sb = createBrowserSupabase();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [result, setResult] = useState<{ ok: true } | { ok: false; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const here = `/invite/${token}`;

  useEffect(() => {
    sb.auth.getUser().then(({ data }) => setSignedIn(!!data.user));
  }, [sb]);

  async function accept() {
    setBusy(true);
    setResult(await acceptInvite(sb, token));
    setBusy(false);
  }

  if (signedIn === null) return <AuthShell title="同学邀请你">{null}</AuthShell>;

  if (!signedIn) {
    return (
      <AuthShell title="同学邀请你">
        <p>你的同学在“分账本”里记了和你一起花的账。注册或登录后，就能看到你们之间谁欠谁多少。</p>
        <div className="grid grid-cols-2 gap-2">
          <Link className="btn btn-primary" href={`/signup?next=${encodeURIComponent(here)}`}>注册</Link>
          <Link className="btn" href={`/login?next=${encodeURIComponent(here)}`}>已有账号，登录</Link>
        </div>
      </AuthShell>
    );
  }

  if (result?.ok) {
    return (
      <AuthShell title="关联成功">
        <p>以后对方记的分账会自动出现在你的面板上，你们之间的账会互相抵消。</p>
        <Link className="btn btn-primary" href="/">去看面板</Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="同学邀请你">
      <p>确认后，你会和对方互相关联，能看到你们之间的分账。</p>
      {result && !result.ok && <p className="text-sm text-danger" role="alert">{result.message}</p>}
      <button className="btn btn-primary" onClick={accept} disabled={busy}>{busy ? "关联中…" : "确认关联"}</button>
    </AuthShell>
  );
}
