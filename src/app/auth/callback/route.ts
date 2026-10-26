import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/nav/safe-next";
import { createServerSupabase } from "@/lib/supabase/server";

// Target of email links (sign-up confirmation, password reset): swap the one-time code for a session.
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = safeNext(request.nextUrl.searchParams.get("next"));
  if (code) {
    const sb = await createServerSupabase();
    const { error } = await sb.auth.exchangeCodeForSession(code);
    // Expired, already used, or opened in a different browser than the one that asked for it.
    if (error) return NextResponse.redirect(new URL("/login?msg=link_invalid", request.url));
  }
  return NextResponse.redirect(new URL(next, request.url));
}
