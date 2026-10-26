import { expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: vi.fn() }));
import { createServerSupabase } from "@/lib/supabase/server";
import { GET } from "@/app/auth/callback/route";

const sbWith = (error: unknown) => ({ auth: { exchangeCodeForSession: vi.fn(async () => ({ error })) } });

it("continues to the requested page when the link is valid", async () => {
  vi.mocked(createServerSupabase).mockResolvedValue(sbWith(null) as never);
  const res = await GET(new NextRequest("https://app.test/auth/callback?code=abc&next=/reset-password"));
  expect(res.headers.get("location")).toBe("https://app.test/reset-password");
});

it("sends an expired or reused link to login with an explanation", async () => {
  vi.mocked(createServerSupabase).mockResolvedValue(sbWith({ message: "invalid" }) as never);
  const res = await GET(new NextRequest("https://app.test/auth/callback?code=abc&next=/reset-password"));
  expect(res.headers.get("location")).toBe("https://app.test/login?msg=link_invalid");
});
