/** Heuristic URL coercion shared by the URL bar and any
 *  programmatic-navigation callers. */

const HAS_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const LOOKS_LIKE_HOST =
  /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/.*)?$|^\[[0-9a-fA-F:]+\](:\d+)?(\/.*)?$|^([\w-]+\.)+[a-zA-Z]{2,}(:\d+)?(\/.*)?$/;

/** Returns a canonical URL string when the input looks like a URL or
 *  bare hostname; otherwise null (the caller falls back to searchUrl). */
export function normalizeUrl(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  if (HAS_SCHEME.test(s)) return s;
  if (LOOKS_LIKE_HOST.test(s)) return `https://${s}`;
  return null;
}

/** DuckDuckGo search URL for free-text URL bar input. Choice is documented
 *  in the plan: no Google account-bind, lighter privacy story.
 *  Configurable is deferred to a follow-up. */
export function searchUrl(query: string): string {
  return `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
}

/** Resolve a URL-bar input to a navigable URL. Bare-query inputs go to
 *  the configured search engine. */
export function resolveBarInput(input: string): string {
  return normalizeUrl(input) ?? searchUrl(input);
}
