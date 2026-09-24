# Resubmission checklist — after the 2026-09-24 suspension (5.1.2)

Tracking: busymate-devtools#3718 · Shopify reference **132497** · app **Busymate AI**
(Partner app 416416825345) · status **Paused**, review suspended until **2026-10-08**.

**RESUBMISSION IS HELD FOR THE OWNER.** Nothing here submits or resubmits the app, and no
app version is released. Resubmit from the Partner Dashboard only on the owner's go, not
before 2026-10-08, and only after every "Before resubmitting" box below is ticked.

## What the reviewers reported (verbatim)

> 5.1.2 Properly show theme app extension in the storefront: "Upon turning on the app embed
> in the theme editor, the app block has been added. However, when the block has been
> opened, it only shows a refused to connect interface. This has been tested on both of our
> test stores and the same behavior has been observed... Additionally, when the admin and
> stores have been closed down and reopened, the block no longer shows on both of the theme
> editor and on the storefront as well."

Reason for the pause: "Multiple failures to resolve a core requirement issue".

## 5.1.2 — fixed, and why it stays fixed

"Refused to connect" was **our** `frame-ancestors` header on `busymate.ai/support/<slug>`,
never Shopify (the storefront's own CSP has no `frame-src`/`script-src` limits). Root
causes and the change that closes each:

| # | Cause (live evidence) | Fix | Where |
|---|---|---|---|
| 1 | **Reinstall deadlock** — the projection readiness gate judged the tenant's CURRENT state (suspended by the uninstall) instead of the incoming revision (active), so a reinstall was refused forever (a reviewer store: revisions 3–6 in error after 29–33 attempts, its frame stayed `frame-ancestors 'self'`) | the gate judges the incoming revision; a suspension always applies; stuck revisions apply on their next retry | platform `v2/scripts/lib/support-model-route-readiness.mjs` |
| 2 | **Opened too soon after install** — frameable only once projected (the second reviewer store: published 18:15:43, opened 18:15:59, applied 18:16:01); a cached "closed" answer held 30 s | projection every 10 s; a closed answer is held ≤ 2 s and never served stale; the loader pre-flights `/api/embed-status` on open and never shows a frame the browser would refuse — it waits, then opens by itself | platform `support-projection` timer, `framePolicyClient.ts`, `public/embed/v1.js`, `app/api/embed-status` |
| 3 | **Old tenants lack the Theme Editor frames** (`admin.shopify.com` → `online-store-web.shopifyapps.com` → the store; our demo store refused in the editor) | the header authority derives both exact editor origins (and the `*.shopifypreview.com` preview pattern) for every tenant whose own allowlist names a `*.myshopify.com` store — no merchant action, no wildcard for other tenants | platform `lib/embed/shopifyEditorParents.ts`, `frameAncestors.ts` |
| 4 | **Orphaned tenant** — our demo store's app row said published, the platform tenant was gone (launch 403 `tenant_not_found`) | afterAuth self-heals an orphan on the next admin open; `npm run tenants:reconcile -- --apply <shop>` repairs it now | this app `authNeedsProvision`, `scripts/reconcile-tenants.ts` |
| 5 | **Revision skew** — "We could not start this AI experience" for ~1 min after each re-publish | a launch accepts a platform revision AHEAD of the page's (never an older one) | platform `lib/supportSessionLaunch.ts` |
| 6 | **Every admin open > 1 h after the last re-published** (expiring offline tokens re-run afterAuth) | afterAuth provisions only a new / reinstalled / errored / orphaned tenant | this app `app/lib/provision.ts`, `app/bmai.server.ts` |
| 7 | **"No longer shows after reopening"** — the panel's open state is per tab (by design); the frozen tenant from #1; a 502 on `/embed/v1.js` during a web restart | #1 fixed; nginx serves the last good `/embed/` bytes on a 5xx; the launcher never opens the browser's error page (#2) | platform `v2/infra/nginx/snippets/busymate-v2-routes.conf` |
| 8 | **Home said "Off"** for an embed that was on (stale CDN id) and offered the CTA before the chat could open | detection by asset + store slug; Home enables "Turn on the storefront assistant" only when the chat is frameable in the Online Store AND the Theme Editor, and re-checks every 5 s | this app `app/lib/themeEmbed.ts`, `app/lib/embedFrameable.ts`, `app/routes/app._index.tsx` |

The theme app extension itself does not need to change (it renders one script tag). The
`assistant.js` hardening on this branch (retry + fallback link) is optional and ships only
with a new extension version the owner chooses to create and release.

### How to verify 5.1.2 (do this after both halves are deployed)

1. `curl -sI "https://busymate.ai/support/shop-busymate-ai-demo-store?channel=embed"` — the
   `content-security-policy` names `https://admin.shopify.com
   https://online-store-web.shopifyapps.com https://*.shopifypreview.com` and there is no
   `x-frame-options`.
2. `curl -s "https://busymate.ai/api/embed-status?assistant=shop-busymate-ai-demo-store&ancestors=https%3A%2F%2Fbusymate-ai-demo-store.myshopify.com%2Chttps%3A%2F%2Fonline-store-web.shopifyapps.com%2Chttps%3A%2F%2Fadmin.shopify.com"`
   → `{"v":1,"frameable":true,"embed":true}`; the same with `ancestors=https%3A%2F%2Fevil.example` → `"frameable":false`.
3. **Fresh install, App Test Store -2 (`gknqt6-9w`)**: install → Home → wait until
   "Turn on the storefront assistant" is enabled → click → Save → in the editor preview open
   "Ask us" within 5 s → the chat renders (not refused) and answers a policy question.
4. **Storefront, anonymous**: a fresh browser context (no admin session), open the store,
   enter the storefront password → "Ask us" → chat renders and answers.
5. **Uninstall → reinstall** the app on the same store → repeat 3 and 4.
6. **Close everything and reopen**: close every admin and storefront tab (a new browser
   context), reopen the theme editor and the storefront → the launcher shows in both and the
   chat opens.
7. **Second store**: the Busymate AI Demo Store editor + storefront (after
   `npm run tenants:reconcile -- --apply busymate-ai-demo-store.myshopify.com`).

## Full requirement checklist with our evidence

Requirement numbers are the ones Shopify's reviewers and our records have used; confirm the
current list on the Partner Dashboard submission page before resubmitting.

| Requirement | State | Evidence |
|---|---|---|
| **5.1.2** Theme app extension shows properly in the Theme Editor and Online Store | fixed (deploy pending) | table above; local proof of the new loader against the real frame-policy code, [`5.1.2-proof/`](5.1.2-proof/) (L01 old loader "refused", L02 new loader holds instead, L03 opens by itself when the tenant goes live, L04 cold tab as an anonymous shopper, L05 a disallowed origin is held, never refused); platform tests `embedStatus.test.ts`, `frameAncestors.test.ts`, `embedLoaderFrameGate.test.ts` |
| **5.1.3** Onboarding for theme app extensions (deep link + written steps) | met | Home "Turn on the storefront assistant" (`activateAppId=<client_id>/assistant`) + "Or do it by hand" steps; now gated on frameability |
| **5.1.5** Send collected data back to the merchant | met | Conversations page (`list_tenant_conversations`, open handoffs) |
| **2.1.1** No critical errors | met | afterAuth never throws (`provisionOnInstall`); route boundaries recover in-frame; no web 500 (0.1.8) |
| **2.1.3** An interactive UI | met | every embedded route renders under Polaris and returns 200 |
| **2.3.1** No manual myshopify.com entry | met | `/auth/login` redirects to managed install (`test/authLogin.test.ts`) |
| **1.2.1 / 1.2.2** Shopify Billing (App Pricing), plan changes work | met (09-13) | Billing → hosted pricing page; `app_subscriptions/update` sync |
| **4.5.4** Current test credentials | met | none required; testing instructions say so; "no account required" set — update the testing-instructions text (below) |
| **4.2.3 / 4.3.3 / 4.4.1** Listing copy (pricing only in Pricing details, factual, no numerals) | met | `test/listing-copy.test.ts` ×14 locales, drift-checked against the canonical store record |
| Mandatory GDPR webhooks | met | `compliance_topics`; `customers/data_request`, `customers/redact`, `shop/redact` handlers, HMAC-verified |
| `app/uninstalled`, `app/scopes_update` | met | suspend + session purge; reinstall reactivates the tenant |
| Current Admin API version | met | `2026-07` pinned |
| Expiring offline access tokens | met | `future.expiringOfflineAccessTokens: true`; no re-publish on re-exchange (0.1.12) |
| Privacy policy + FAQ URLs | met | `https://store.busymate.ai/legal/privacy`, `/legal/faq` |
| Storefront performance | met | the loader is deferred, its bytes budgeted (71,769 raw / 23,819 gz after this change, inside the ordinary budget); no fetch at mount |
| Credentials in logs | fixed | `id_token` / `hmac` / `session` / `code` / `signature` redacted from the host access log (0.1.12) |

## Before resubmitting (owner)

- [ ] Platform half shipped (busymate-devtools `fix/shopify-512`, ai build ≥ 936) and
      steps 1–2 above pass.
- [ ] App 0.1.12 deployed to `store.busymate.ai` (SETUP §3b) — `/api/bmai/status` ok,
      a request line in the journal shows `id_token=REDACTED`.
- [ ] `npm run tenants:reconcile` (dry-run) reviewed; `--apply` run for our own dev stores.
- [ ] Steps 3–7 above pass; screenshots filed with #3718.
- [ ] Testing instructions updated: add "Turn on the storefront assistant becomes available
      once your assistant is live (usually under a minute); the page checks by itself" and
      the 5.1.2 fix line.
- [ ] Owner's explicit go → Partner Dashboard → resubmit (not before 2026-10-08).
