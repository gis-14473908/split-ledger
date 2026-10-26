"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";

/** Fire on window after a transaction leaves or re-enters the pending queue. */
export const PENDING_CHANGED = "pending-changed";

const HIDDEN = ["/login", "/signup", "/invite", "/auth"];

const ITEMS = [
  { href: "/", label: "面板" },
  { href: "/import", label: "导入" },
  { href: "/review", label: "待处理" },
  { href: "/settings", label: "设置" },
];

export function BottomNav() {
  const path = usePathname();
  const [pending, setPending] = useState(0);
  const hidden = HIDDEN.some((p) => path === p || path.startsWith(`${p}/`));

  useEffect(() => {
    if (hidden) return;
    const refresh = () =>
      createBrowserSupabase()
        .from("transactions")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .then(({ count }) => setPending(count ?? 0));
    refresh();
    window.addEventListener(PENDING_CHANGED, refresh);
    return () => window.removeEventListener(PENDING_CHANGED, refresh);
  }, [path, hidden]);

  if (hidden) return null;
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <ul className="mx-auto flex max-w-[480px]">
        {ITEMS.map((item) => {
          const active = item.href === "/" ? path === "/" : path.startsWith(item.href);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                className={`relative flex flex-col items-center py-3 text-sm ${active ? "font-bold text-accent" : "text-muted"}`}
              >
                {item.label}
                {item.href === "/review" && pending > 0 && (
                  <span className="num absolute top-1.5 left-1/2 ml-5 rounded-full bg-accent px-1.5 text-[11px] leading-5 text-white">
                    {pending}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
