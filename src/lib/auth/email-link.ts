/**
 * Password-recovery emails sent from the Supabase dashboard point at the site root
 * ("/?code=…") instead of /auth/callback. Route them through the callback to the
 * set-new-password page.
 */
export function emailLinkRedirect(url: URL): URL | null {
  const code = url.searchParams.get("code");
  if (url.pathname !== "/" || !code) return null;
  const target = new URL("/auth/callback", url);
  target.searchParams.set("code", code);
  target.searchParams.set("next", "/reset-password");
  return target;
}
