"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { GearIcon, HomeIcon, ListIcon, SwipeIcon, UploadIcon } from "@/components/icons";
import { createBrowserSupabase } from "@/lib/supabase/browser";

/** Fire on window after a transaction leaves or re-enters the pending queue. */
export const PENDING_CHANGED = "pending-changed";

const HIDDEN = ["/login", "/signup", "/invite", "/auth", "/forgot", "/reset-password"];

const ITEMS = [
  { href: "/", label: "面板", Icon: HomeIcon },
  { href: "/bills", label: "账单", Icon: ListIcon },
  { href: "/import", label: "导入", Icon: UploadIcon },
  { href: "/review", label: "待处理", Icon: SwipeIcon },
  { href: "/settings", label: "设置", Icon: GearIcon },
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
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/90 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <ul className="mx-auto flex max-w-[480px]">
        {ITEMS.map((item) => {
          const active = item.href === "/" ? path === "/" : path.startsWith(item.href);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                className={`relative flex flex-col items-center gap-0.5 pt-2.5 pb-2 text-[11px] transition-colors ${active ? "font-bold text-accent" : "text-muted"}`}
              >
                <span className={`grid h-7 w-12 place-items-center rounded-full transition-colors ${active ? "bg-accent-soft" : ""}`}>
                  <item.Icon size={20} />
                </span>
                {item.label}
                {item.href === "/review" && pending > 0 && (
                  <span className="num absolute top-1 left-1/2 ml-3 rounded-full bg-accent px-1.5 text-[11px] leading-5 text-white">
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
