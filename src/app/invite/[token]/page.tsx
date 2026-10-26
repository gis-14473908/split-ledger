"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { AuthShell } from "@/components/AuthShell";
import { acceptInvite, inviteInfo } from "@/lib/data/dashboard";
import type { Contact } from "@/lib/db/types";
import { createBrowserSupabase } from "@/lib/supabase/browser";

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const sb = createBrowserSupabase();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [inviter, setInviter] = useState<string | null | undefined>(undefined);
  const [unlinked, setUnlinked] = useState<Contact[]>([]);
  const [pick, setPick] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: true } | { ok: false; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const here = `/invite/${token}`;

  useEffect(() => {
    sb.auth.getUser().then(async ({ data }) => {
      setSignedIn(!!data.user);
      if (!data.user) return;
      setInviter(await inviteInfo(sb, token).catch(() => null));
      const { data: rows } = await sb.from("contacts").select("*").is("linked_user_id", null).order("created_at");
      setUnlinked((rows ?? []) as Contact[]);
    });
  }, [sb, token]);

  async function accept() {
    setBusy(true);
    setResult(await acceptInvite(sb, token, pick));
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

  if (inviter === null) {
    return (
      <AuthShell title="链接已失效">
        <p>这个邀请链接已经用过或者不存在，请让对方重新生成一个。</p>
        <Link className="btn" href="/">回到面板</Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={inviter ? `${inviter} 邀请你关联` : "同学邀请你"}>
      <p>确认后，你和 {inviter ?? "对方"} 会互相关联，能看到你们之间的分账，双方记的账会互相抵消。</p>

      {unlinked.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted">你之前是不是已经用名字记过 TA？选中的话，之前的记录会合并到一起：</p>
          <div className="flex flex-wrap gap-2">
            {unlinked.map((c) => (
              <button
                key={c.id}
                aria-pressed={pick === c.id}
                onClick={() => setPick((p) => (p === c.id ? null : c.id))}
                className={`rounded-full border px-3.5 py-1.5 text-sm ${pick === c.id ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface"}`}
              >
                {c.name}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted">{pick ? "将关联到选中的联系人" : "不选的话会新建一个联系人"}</p>
        </div>
      )}

      {result && !result.ok && <p className="text-sm text-danger" role="alert">{result.message}</p>}
      <button className="btn btn-primary" onClick={accept} disabled={busy}>{busy ? "关联中…" : "确认关联"}</button>
    </AuthShell>
  );
}
