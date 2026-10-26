/** Only allow redirects to paths on this site, never to another origin. */
export function safeNext(next: string | null | undefined, fallback = "/"): string {
  // Control characters are stripped by the URL parser, so "/\t/evil.com" would become "//evil.com".
  if (!next || !next.startsWith("/") || /[\x00-\x1f\\]/.test(next) || next.startsWith("//")) return fallback;
  return next;
}
