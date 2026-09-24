import { describe, expect, it, vi } from "vitest";
import {
  THEME_EDITOR_ANCESTORS,
  embedCtaReady,
  embedStatusUrl,
  foldFrameable,
  parseEmbedStatus,
  readStorefrontFrameable,
} from "../app/lib/embedFrameable";

/**
 * #3718 — Home offers "Turn on the storefront assistant" only once the chat can
 * actually be framed in the Online Store AND the Theme Editor (the reviewers
 * turned the embed on during activation and got "refused to connect").
 */
describe("embed frameability (#3718)", () => {
  it("asks the platform with the store origin, and with the full Theme Editor chain", async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      urls.push(url);
      return { ok: true, json: async () => ({ v: 1, frameable: true }) } as unknown as Response;
    }) as unknown as typeof fetch;
    const result = await readStorefrontFrameable({ platformOrigin: "https://busymate.ai", shop: "demo.myshopify.com", slug: "shop-demo" }, fetchImpl);
    expect(result).toBe(true);
    const chains = urls.map((u) => new URL(u).searchParams.get("ancestors"));
    expect(chains).toEqual([
      "https://demo.myshopify.com",
      ["https://demo.myshopify.com", ...THEME_EDITOR_ANCESTORS].join(","),
    ]);
    expect(new URL(urls[0]!).searchParams.get("assistant")).toBe("shop-demo");
  });

  it("a refusal in EITHER place is a no (the editor chain alone refused)", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ frameable: n++ === 0 }) }) as unknown as Response) as unknown as typeof fetch;
    expect(await readStorefrontFrameable({ platformOrigin: "https://busymate.ai", shop: "d.myshopify.com", slug: "shop-d" }, fetchImpl)).toBe(false);
  });

  it("a platform that cannot answer (network error, 5xx, no endpoint yet) is unknown, never a no", async () => {
    const down = vi.fn(async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch;
    expect(await readStorefrontFrameable({ platformOrigin: "https://busymate.ai", shop: "d.myshopify.com", slug: "shop-d" }, down)).toBeNull();
    const notFound = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }) as unknown as Response) as unknown as typeof fetch;
    expect(await readStorefrontFrameable({ platformOrigin: "https://busymate.ai", shop: "d.myshopify.com", slug: "shop-d" }, notFound)).toBeNull();
  });

  it("parses only a boolean frameable", () => {
    expect(parseEmbedStatus({ frameable: true })).toBe(true);
    expect(parseEmbedStatus({ frameable: false })).toBe(false);
    expect(parseEmbedStatus({ frameable: null })).toBeNull();
    expect(parseEmbedStatus({ frameable: "true" })).toBeNull();
    expect(parseEmbedStatus(null)).toBeNull();
  });

  it("folds: any no wins, then unknown, else yes", () => {
    expect(foldFrameable([true, true])).toBe(true);
    expect(foldFrameable([true, false])).toBe(false);
    expect(foldFrameable([null, false])).toBe(false);
    expect(foldFrameable([true, null])).toBeNull();
    expect(foldFrameable([])).toBe(false);
  });

  it("the CTA needs a live assistant, and is held on a definite no only", () => {
    expect(embedCtaReady(true, true)).toBe(true);
    expect(embedCtaReady(true, null)).toBe(true);
    expect(embedCtaReady(true, false)).toBe(false);
    expect(embedCtaReady(false, true)).toBe(false);
  });

  it("builds the public endpoint URL on the platform origin", () => {
    expect(embedStatusUrl("https://busymate.ai", "shop-x", ["https://x.myshopify.com"])).toBe(
      "https://busymate.ai/api/embed-status?assistant=shop-x&ancestors=https%3A%2F%2Fx.myshopify.com",
    );
  });
});
