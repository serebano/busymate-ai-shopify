/**
 * Is the storefront assistant FRAMEABLE right now? (#3718 — Shopify review 5.1.2)
 *
 * The reviewers turned the app embed on while the assistant was still being
 * activated, opened the chat, and got the browser's "busymate.ai refused to
 * connect". Home offered "Turn on the storefront assistant" as soon as the
 * install published, although the chat frame opens only once the platform has
 * applied that publish.
 *
 * The platform answers the exact question the browser will ask — would these
 * ancestors be allowed by this tenant's `frame-ancestors`? — at the public
 * `GET <platform>/api/embed-status?assistant=<slug>&ancestors=<origins>` (part
 * of the white-label embed contract; the same answer the storefront loader
 * pre-flights). Home asks it for BOTH places a merchant and a reviewer look:
 *
 *   • the Online Store:  https://<shop>.myshopify.com
 *   • the Theme Editor:  the store preview inside online-store-web.shopifyapps.com
 *                        inside admin.shopify.com (every ancestor is checked)
 *
 * `true` only when both are allowed, `false` when either is definitely refused,
 * `null` when the platform could not be asked (network, 5xx, an older platform
 * without the endpoint) — never read as a "no"; the caller falls back to the
 * runtime-readiness check it already had.
 */
export type Frameable = boolean | null;

/** Shopify's Theme Editor frames, innermost first (as `location.ancestorOrigins` lists them). */
export const THEME_EDITOR_ANCESTORS = ["https://online-store-web.shopifyapps.com", "https://admin.shopify.com"] as const;

export function embedStatusUrl(platformOrigin: string, slug: string, ancestors: readonly string[]): string {
  const url = new URL("/api/embed-status", platformOrigin);
  url.searchParams.set("assistant", slug);
  url.searchParams.set("ancestors", ancestors.join(","));
  return url.toString();
}

/** The endpoint's body → true / false / null (anything unexpected is null). */
export function parseEmbedStatus(body: unknown): Frameable {
  if (!body || typeof body !== "object") return null;
  const value = (body as { frameable?: unknown }).frameable;
  return typeof value === "boolean" ? value : null;
}

/** Fold the two answers: any definite no wins, then any unknown, else yes. */
export function foldFrameable(answers: readonly Frameable[]): Frameable {
  if (answers.some((a) => a === false)) return false;
  if (answers.some((a) => a === null)) return null;
  return answers.length > 0;
}

async function ask(url: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<Frameable> {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" } });
    if (!res.ok) return null;
    return parseEmbedStatus(await res.json());
  } catch {
    return null;
  }
}

/** Online Store AND Theme Editor, concurrently, bounded by `timeoutMs` each. */
export async function readStorefrontFrameable(
  opts: { platformOrigin: string; shop: string; slug: string },
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 2500,
): Promise<Frameable> {
  const store = `https://${opts.shop}`;
  const answers = await Promise.all([
    ask(embedStatusUrl(opts.platformOrigin, opts.slug, [store]), fetchImpl, timeoutMs),
    ask(embedStatusUrl(opts.platformOrigin, opts.slug, [store, ...THEME_EDITOR_ANCESTORS]), fetchImpl, timeoutMs),
  ]);
  return foldFrameable(answers);
}

/**
 * Home's "Turn on the storefront assistant" CTA is offered only when the
 * assistant can actually be shown: live on the platform AND (when the platform
 * could answer) frameable in both places. An unanswered frameability check
 * falls back to the runtime readiness alone — never blocks on "couldn't ask".
 */
export function embedCtaReady(live: boolean, frameable: Frameable): boolean {
  return live && frameable !== false;
}
