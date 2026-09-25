import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { authenticateWebhookWithoutSession, verifyWebhookHmac, webhookTopicKey } from "../app/lib/webhookAuth";

// busymate-devtools#3731: app/uninstalled and the GDPR compliance topics answered
// 500 whenever the shop's offline token had expired, because the library's
// authenticate.webhook refreshes it first and the refresh fails after an
// uninstall. These routes now verify the HMAC without touching a session.

// Synthetic key, NOT a real Shopify app secret (any string works here).
const SECRET = "example-webhook-secret-not-real";
const shop = "acme.myshopify.com";

function sign(body: string, secret = SECRET): string {
  return crypto.createHmac("sha256", secret).update(body, "utf8").digest("base64");
}

function webhook(
  body: string,
  opts: { topic?: string; hmac?: string | null; method?: string; headers?: Record<string, string | null> } = {},
): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-shopify-topic": opts.topic ?? "app/uninstalled",
    "x-shopify-shop-domain": shop,
    "x-shopify-webhook-id": "b54557e4-bdd9-4b37-8a5f-bf7d70bcd043",
    "x-shopify-api-version": "2026-07",
  };
  const hmac = opts.hmac === undefined ? sign(body) : opts.hmac;
  if (hmac !== null) headers["x-shopify-hmac-sha256"] = hmac;
  for (const [k, v] of Object.entries(opts.headers ?? {})) {
    if (v === null) delete headers[k];
    else headers[k] = v;
  }
  const method = opts.method ?? "POST";
  return new Request("https://store.busymate.ai/webhooks/app/uninstalled", {
    method,
    headers,
    body: method === "POST" ? body : undefined,
  });
}

async function statusOf(p: Promise<unknown>): Promise<number | "resolved"> {
  try {
    await p;
    return "resolved";
  } catch (err) {
    if (err instanceof Response) return err.status;
    throw err;
  }
}

describe("session-free webhook authentication (#3731)", () => {
  it("accepts a correctly signed app/uninstalled delivery and normalises the topic like the library", async () => {
    const body = JSON.stringify({ id: 1, domain: shop });
    const out = await authenticateWebhookWithoutSession(webhook(body), SECRET);
    expect(out).toMatchObject({ shop, topic: "APP_UNINSTALLED", payload: { id: 1, domain: shop }, apiVersion: "2026-07" });
  });

  it("maps every compliance topic to the key handleComplianceTopic switches on", () => {
    expect(webhookTopicKey("customers/data_request")).toBe("CUSTOMERS_DATA_REQUEST");
    expect(webhookTopicKey("customers/redact")).toBe("CUSTOMERS_REDACT");
    expect(webhookTopicKey("shop/redact")).toBe("SHOP_REDACT");
  });

  it("passes a shop/redact payload through for the compliance dispatch", async () => {
    const body = JSON.stringify({ shop_id: 9, shop_domain: shop });
    const out = await authenticateWebhookWithoutSession(webhook(body, { topic: "shop/redact" }), SECRET);
    expect(out.topic).toBe("SHOP_REDACT");
    expect(out.payload).toEqual({ shop_id: 9, shop_domain: shop });
  });

  it("401 on a tampered body, a wrong secret, a missing HMAC or an empty secret (fail-closed)", async () => {
    const body = JSON.stringify({ id: 1 });
    expect(await statusOf(authenticateWebhookWithoutSession(webhook(body, { hmac: sign('{"id":2}') }), SECRET))).toBe(401);
    expect(await statusOf(authenticateWebhookWithoutSession(webhook(body, { hmac: sign(body, "wrong") }), SECRET))).toBe(401);
    expect(await statusOf(authenticateWebhookWithoutSession(webhook(body, { hmac: null }), SECRET))).toBe(401);
    expect(await statusOf(authenticateWebhookWithoutSession(webhook(body), ""))).toBe(401);
  });

  it("405 for a non-POST, 400 for missing headers, a non-myshopify shop or a non-JSON body", async () => {
    expect(await statusOf(authenticateWebhookWithoutSession(webhook("", { method: "GET" }), SECRET))).toBe(405);
    const body = JSON.stringify({ id: 1 });
    expect(await statusOf(authenticateWebhookWithoutSession(webhook(body, { headers: { "x-shopify-topic": null } }), SECRET))).toBe(400);
    expect(await statusOf(authenticateWebhookWithoutSession(webhook(body, { headers: { "x-shopify-webhook-id": null } }), SECRET))).toBe(400);
    expect(
      await statusOf(authenticateWebhookWithoutSession(webhook(body, { headers: { "x-shopify-shop-domain": "evil.example" } }), SECRET)),
    ).toBe(400);
    expect(await statusOf(authenticateWebhookWithoutSession(webhook("not json"), SECRET))).toBe(400);
  });

  it("verifyWebhookHmac compares in constant time and rejects a length mismatch", () => {
    const body = "{}";
    expect(verifyWebhookHmac(body, sign(body), SECRET)).toBe(true);
    expect(verifyWebhookHmac(body, sign(body).slice(0, -2), SECRET)).toBe(false);
    expect(verifyWebhookHmac(body, null, SECRET)).toBe(false);
  });

  it("the uninstall and compliance routes never go through authenticate.webhook (the session-refreshing path)", () => {
    for (const route of ["app/routes/webhooks.app.uninstalled.tsx", "app/routes/webhooks.compliance.tsx"]) {
      const src = readFileSync(route, "utf8");
      expect(src, route).toContain("authenticateWebhookWithoutSession(request)");
      expect(src, route).not.toMatch(/authenticate\.webhook\(/);
    }
  });
});
