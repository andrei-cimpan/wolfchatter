/**
 * Where to send someone after sign-in: a path on this site, or "/". The value comes from the URL,
 * so anyone can craft it; a path that a browser would read as another host ("//evil.com", "/\evil.com",
 * or either spelled with escapes) would turn sign-in into an open redirect.
 */
export function safeNextPath(raw: string | null): string {
  if (!raw || !raw.startsWith("/")) return "/";
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return "/";
  }
  // Browsers treat "\" as "/" and drop tabs and newlines in URLs, so check what they would see.
  const seen = decoded.replace(/[\t\n\r]/g, "").replace(/\\/g, "/");
  if (seen.startsWith("//") || /[\t\n\r\\]/.test(raw)) return "/";
  // Resolving against a placeholder origin is what a browser does; anything leaving it is refused.
  const base = "http://same.invalid";
  return new URL(raw, base).origin === base ? raw : "/";
}
