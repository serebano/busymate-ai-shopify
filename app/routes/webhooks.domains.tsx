import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { refreshStorefrontDomains } from "../bmai.server";

// #3718 (Shopify review 5.1.2) — a custom domain connected, changed or removed
// after install. The chat frame's `frame-ancestors` must name every storefront
// domain a shopper can load, so a domain change re-reads the store's domains and
// repairs the tenant when its published allowlist lacks one (app/lib/tenantRepair.ts).
// Answered at once (Shopify retries a slow webhook); the refresh runs in the
// background, gated per shop, and never throws.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`[domains] ${shop}: ${topic} → refreshing storefront domains`);
  void refreshStorefrontDomains(shop);
  return new Response();
};
