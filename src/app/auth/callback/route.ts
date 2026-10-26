import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/nav/safe-next";
import { createServerSupabase } from "@/lib/supabase/server";

// Target of the email-confirmation link: swap the one-time code for a session.
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = safeNext(request.nextUrl.searchParams.get("next"));
  if (code) {
    const sb = await createServerSupabase();
    await sb.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(new URL(next, request.url));
}
