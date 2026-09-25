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

## 5.1.2 — what broke, and the change that closes each (deploy pending)

"Refused to connect" was **our** `frame-ancestors` header on `busymate.ai/support/<slug>`,
never Shopify (the storefront's own CSP has no `frame-src`/`script-src` limits).

| # | Cause (live evidence) | Fix | Where |
|---|---|---|---|
| 1 | **Reinstall deadlock** — the projection readiness gate judged the tenant's CURRENT state (suspended by the uninstall) instead of the incoming revision (active), so a reinstall was refused forever (a reviewer store: revisions 3–6 in error after 29–33 attempts, its frame stayed `frame-ancestors 'self'`) | the gate judges the incoming revision; a suspension always applies; stuck revisions apply on their next retry | platform `v2/scripts/lib/support-model-route-readiness.mjs` |
| 2 | **Opened too soon after install** — frameable only once projected (the second reviewer store: published 18:15:43, opened 18:15:59, applied 18:16:01); a cached "closed" answer held 30 s | projection every 10 s; a closed answer is held ≤ 2 s and never served stale; the loader pre-flights `/api/embed-status` on open and never shows a frame the browser would refuse — it waits, then opens by itself | platform `support-projection` timer, `framePolicyClient.ts`, `public/embed/v1.js`, `app/api/embed-status` |
| 3 | **Old tenants lack the Theme Editor frames** (`admin.shopify.com` → `online-store-web.shopifyapps.com` → the store; our demo store refused in the editor) | the header authority derives both exact editor origins (and the `*.shopifypreview.com` preview pattern) for every tenant whose own allowlist names a `*.myshopify.com` store — no merchant action, no wildcard for other tenants. The `support-launch` parent-origin gate derives the SAME parents from the SAME leaf (byte-identical Edge copy), so a theme-preview link that the header lets frame the chat also starts it — before round 3 it answered 403 `origin_not_allowed` ("We could not start this AI experience"). That gate deploys from busymate-ai (the Edge leg of the platform ship) | platform `lib/embed/shopifyEditorParents.ts`, `frameAncestors.ts`, `supabase/functions/_shared/shopifyEditorParents.ts`, `_shared/supportLaunch.ts` (`embedParentListed`) |
| 4 | **Orphaned tenant** — our demo store's app row said published, the platform tenant was gone (launch 403 `tenant_not_found`) | the platform's own answer (`get_tenant_integration` → "tenant integration administration denied" / "unavailable") is a first-class `orphaned` readiness state. afterAuth checks a live row in the background, Home checks on every load, and `npm run tenants:reconcile` classifies it — each repairs it with the idempotent lifecycle, **no flag**, gated to one run per shop per 10 min. A timeout or 5xx is `unverified`, never a repair | this app `app/lib/runtimeReadiness.ts`, `app/lib/tenantRepair.ts`, `app/lib/reconcile.ts`, `app/bmai.server.ts` |
| 5 | **Revision skew** — "We could not start this AI experience" for ~1 min after each re-publish. Accepting the newer revision at launch alone only MOVED it to the first message: the session is pinned to the platform head while the chat server still serves the previous revision, so every turn answered "usage limits could not be verified" | a launch accepts a platform revision AHEAD of the page's (never an older one) **and the frame holds that session until the chat server reports it applied** (`/api/embed-status` → `revision`), so the first message is served; honest error after 60 s | platform `lib/supportSessionLaunch.ts`, `lib/support/appliedRevisionWait.ts`, `SupportChatGate.tsx` |
| 6 | **Every admin open > 1 h re-published** (expiring offline tokens re-run afterAuth) | afterAuth provisions only a new / reinstalled / errored tenant; a live one is only checked (cause 4, cause 9) and repaired on a definite answer | this app `app/lib/provision.ts`, `app/bmai.server.ts` |
| 7 | **"No longer shows after reopening"** — the panel's open state is per tab (by design); the frozen tenant from #1; a 502 on `/embed/v1.js` during a web restart. The reviewer's third video (NanoMachh, Horizon theme): App embeds toggle **on and saved** (Save greyed), no launcher, and **no request for that store's slug reached busymate.ai from any IP between 18:12:54 and 19:08:32** — our loader never ran in that document. An unsaved toggle is ruled out for that video (Save is disabled), but it is the same symptom and the old testing instructions said "click Save if prompted". The one silent early return in the live `assistant.js` is a missing `document.currentScript` | #1 fixed; nginx serves the last good `/embed/` bytes on a 5xx; the launcher never opens the browser's error page (#2). Home and the testing instructions now say the embed stays on **only after Save**, and acceptance step 6 checks the toggle is still on (saved) after closing and reopening. The `assistant.js` hardening on this branch (a `currentScript` fallback, re-mount after a Theme Editor section re-render, retry + fallback link) closes the silent return — it ships only with a new extension version (owner's decision, below) | platform `v2/infra/nginx/snippets/busymate-v2-routes.conf`; this app `app/lib/themeEmbed.ts`, `extensions/storefront-assistant/assets/assistant.js` |
| 8 | **Home said "Off"** for an embed that was on (stale CDN id), and offered the CTA before the chat could open | detection by asset + store slug. The platform's frameability answer decides the CTA whenever it answered: **`frameable: true` enables "Turn on the storefront assistant" even while the readiness read is unverified or pending**; `false` holds it; only when the platform could not be asked does readiness decide, and "couldn't ask" never holds it (5.1.3 deep link). While held, Home re-checks every 5 s for 5 min, then every 30 s with a "taking longer" banner and Retry setup — it never stops. (Round 3: the first version restarted its loop at every re-check — react-router hands out a new revalidator object on each one — so the banner never came; the loop now runs once per hold, proven in a real data router by `test/activationRecheck.test.ts`, which fails on the old wiring.) | this app `app/lib/themeEmbed.ts`, `app/lib/embedFrameable.ts`, `app/lib/activationRecheck.ts`, `app/lib/useActivationRecheck.ts`, `app/routes/app._index.tsx` |
| 9 | **Custom domains were read only at first provisioning** — a domain connected later (or any tenant provisioned before 0.1.12) was refused on the real storefront | `domains/create`, `domains/update`, `domains/destroy` webhooks (no scope needed; active on the next `shopify app deploy`, which also releases this branch's `assistant.js` — one decision, below) re-read the store's domains and repair the allowlist; the same check runs on every afterAuth and in `tenants:reconcile`, whose frameability check now asks every custom domain too | this app `app/routes/webhooks.domains.tsx`, `shopify.app.toml`, `app/lib/tenantRepair.ts`, `scripts/reconcile-tenants.ts` |

### What the local shots are (and are not)

[`5.1.2-proof/`](5.1.2-proof/) is a **local loader harness**, not proof that 5.1.2 is fixed.
It runs the real `frameAncestors`/`embedStatus` decision code behind a tiny local server and
compares the new loader with the old one, but the page it frames is a **stub** (a static
"Hi! How can I help?", not the real chat), and the only ancestor is `http://127.0.0.1` — no
Shopify store, no Theme Editor chain, no real tenant. L01 old loader shows Chrome's "refused"
page; L02 the new loader holds instead; L03 it opens by itself when the tenant goes live; L05
a disallowed origin is held, never refused. (An earlier "L04 cold tab" shot was a byte-identical
copy of L03 and has been removed.) **The real proof is steps 1–8 below, run on our stores after
both halves are deployed (shots P01–P08 on #3718). Do not call 5.1.2 fixed before they pass.**

### How to verify 5.1.2 (after both halves are deployed)

1. `curl -sI "https://busymate.ai/support/shop-busymate-ai-demo-store?channel=embed"` — the
   `content-security-policy` names `https://admin.shopify.com
   https://online-store-web.shopifyapps.com https://*.shopifypreview.com` and there is no
   `x-frame-options`.
2. `curl -s "https://busymate.ai/api/embed-status?assistant=shop-busymate-ai-demo-store&ancestors=https%3A%2F%2Fbusymate-ai-demo-store.myshopify.com%2Chttps%3A%2F%2Fonline-store-web.shopifyapps.com%2Chttps%3A%2F%2Fadmin.shopify.com"`
   → `"frameable":true` with a numeric `"revision"`; the same with
   `ancestors=https%3A%2F%2Fevil.example` → `"frameable":false`. Theme-preview links: the
   launch-gate probe in the platform ship note (`notes/next-ship/3718-shopify-512.md`, a
   `shopifypreview.com` parent → `400 invalid_revoke`, not `403 launch_denied`) passes. Until it
   does, do not claim preview links work.
3. **Fresh install, App Test Store -2 (`gknqt6-9w`)**: install → Home → wait until
   "Turn on the storefront assistant" is enabled → click → **Save** in the theme editor → in the
   preview open "Ask us" within 5 s → the chat renders (not refused) **and answers a message**.
4. **Storefront, anonymous**: a fresh browser context (no admin session), open the store,
   enter the storefront password → "Ask us" → the chat renders and answers.
5. **Uninstall → reinstall** the app on the same store → repeat 3 and 4.
6. **Close everything and reopen**: close every admin and storefront tab (a new browser
   context), reopen the theme editor → App embeds: **"Busymate AI assistant" is still on and
   Save is greyed (the embed is saved)**; the launcher shows in the editor preview and on the
   storefront, and the chat opens. If the toggle is on and saved but no launcher shows, capture
   the browser's Network panel (the `…/assets/assistant.js` and `busymate.ai/embed/v1.js`
   requests) — that is the reviewer's third video, and it decides the extension-version item
   below.
7. **A message right after a re-publish**: Store connection → Re-train on my store, then
   within 10 s open "Ask us" and send a message → it is answered (never "usage limits could
   not be verified", never "could not start").
8. **Second store**: `npm run tenants:reconcile` (dry-run) must report the Busymate AI Demo
   Store as `orphaned` / `reprovision` **with no flag**; then `npm run tenants:reconcile --
   --apply busymate-ai-demo-store.myshopify.com` → its editor and storefront pass 3, 4 and 6.
   (Custom domains: none of our dev stores has one; the reconcile line lists the `domains` it
   asked the platform about.)

## Requirement checklist (confirmed against shopify.dev on 2026-09-25)

Source: <https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements> and
<https://shopify.dev/docs/apps/launch/protected-customer-data>. Only the requirements that
apply to this app are listed; the numbers are Shopify's.

| Requirement | State | Evidence |
|---|---|---|
| **5.1.2** App widget displayed properly, without errors, in the Theme Editor and Online Store | fixed in code, **not yet proven live** | the table above; steps 1–8 |
| **5.1.1** Theme changes only through a theme app extension | met | one app embed (`storefront-assistant`), no theme file writes, no `read_themes`/`write_themes` scope |
| **5.1.3** Detailed setup instructions for the app embed, deep link recommended | met | Home "Turn on the storefront assistant" (`activateAppId=<client_id>/assistant`) + "Or do it by hand" steps ending in **Save**; never held on "couldn't ask" (cause 8) |
| **5.1.4** App-name branding in storefront components only where shoppers interact with it | check | the launcher label is the merchant's ("Ask us" by default, editable in the embed settings); confirm in step 3 that the chat panel shows the store's assistant, not "Busymate AI" |
| **5.1.5** Collected customer data returned to the merchant's admin | met | Conversations page (`list_tenant_conversations`, open handoffs) |
| **Protected customer data** (Level 1 + Level 2 fields; required before listing, reviewed with the submission) | **draft saved, not approved — owner action below** | Partner Dashboard → API access requests → Protected customer data access: **Draft**, last updated 2026-09-24; reasons: Customer service + App functionality; fields: Name, Email, Address; data protection details 16/16. The scopes are all used: `read_customers` + `read_orders` + `read_fulfillments` (a signed-in shopper's own order status/tracking via `customer(id).orders`), `write_orders` (cancel, update shipping address, refund, draft order — each confirm-gated), `read_returns` + `write_returns` (start a return). Level 2 fields actually touched: **Name, Address and Phone** (only `update_shipping_address` writes them, from the shopper's own input — its address input carries `phone`, which is Shopify's separate Level 2 **Phone** field, `app/mcp/tools/returns.ts`); **no tool reads or writes Email**. The `orders/*` KB webhook stays disabled until approval (`shopify.app.toml`). Reducing scopes would remove the order-aware support the listing describes, so the approval path is the right one |
| **1.1.1** Works without third-party cookies or local storage (incognito Chrome) | met | App Bridge session tokens + token exchange (`@shopify/shopify-app-react-router` 2.1.0, `distribution: AppStore`); server sessions in Prisma, encrypted at rest |
| **2.2.3** Latest App Bridge, `app-bridge.js` before any other script | met | `app/root.tsx`: the CDN `app-bridge.js` tag is the first element in `<head>` |
| **2.2.4** GraphQL Admin API only (new public apps) | met | every Admin call is `admin.graphql`; no REST client |
| **2.3.1** Installed and initiated only on Shopify surfaces | met | managed install; `/auth/login` redirects to Shopify's install and never shows a myshopify.com form (`test/authLogin.test.ts`) |
| **2.3.2 / 2.3.4** Authenticate via OAuth immediately, also on a reinstall | met | Shopify managed installation grants the scopes before the app loads; the first embedded load exchanges the session token for an offline token before any UI (`afterAuth`), on install and reinstall alike |
| **2.3.3** Redirect to the app UI after accepting permissions | met | after the grant Shopify opens the embedded app at `/app` (Home), which renders under Polaris |
| **2.1.1 / 2.1.2** No UI bugs, display issues or error pages | met | afterAuth never throws (`provisionOnInstall`); route boundaries recover in-frame; no web 500 (0.1.8) |
| **2.1.3** Operational through a UI however launched | met | every embedded route renders and returns 200 |
| **1.2.1 / 1.2.2 / 1.2.3** Shopify App Pricing; accept/decline/re-request on reinstall; up/downgrade in-app | met (09-13) | Billing → Shopify's hosted pricing page; `app_subscriptions/update` sync |
| **3.1.1** Valid TLS | met | `store.busymate.ai`, `busymate.ai` |
| **3.2.x** Special scopes (`read_all_orders`, payment mandate, checkout chat, …) | n/a | none requested |
| **4.5.3** A screencast of onboarding and features | **to do (owner)** | record a NEW screencast after steps 1–8 pass (below) |
| **4.5.4 / 4.5.5** Credentials in the testing instructions | met | none required ("no account required" set); update the instructions text (below) |
| **4.5.6** Emergency developer contact | check | Partner Dashboard → Settings (confirm it is set) |
| **4.1.x / 4.2.x / 4.3.x / 4.4.x** Listing name, pricing placement, truthful copy, assets | met | `test/listing-copy.test.ts` ×14 locales, drift-checked against the canonical store record |
| Mandatory GDPR webhooks | met | `compliance_topics`; `customers/data_request`, `customers/redact`, `shop/redact` handlers, HMAC-verified |
| `app/uninstalled`, `app/scopes_update`, `domains/*` | met (`domains/*` on the next deploy) | suspend + session purge; reinstall reactivates the tenant; a domain change repairs the allowlist |
| Current Admin API version; expiring offline tokens | met | `2026-07`; `future.expiringOfflineAccessTokens: true`; no re-publish on re-exchange (0.1.12) |
| Privacy policy + FAQ URLs | met | `https://store.busymate.ai/legal/privacy`, `/legal/faq` |
| Storefront performance | met | the loader is deferred, its bytes budgeted (71,769 raw / 23,819 gz), no fetch at mount |
| Credentials in logs | fixed | `id_token` / `hmac` / `session` / `code` / `signature` redacted from the host access log (0.1.12) |

## Before resubmitting (owner)

- [ ] Platform half shipped (busymate-devtools `fix/shopify-512`, ai build ≥ 937), **including
      its busymate-ai Edge leg** (`support-launch` redeployed), and steps 1–2 pass.
- [ ] App 0.1.12 deployed to `store.busymate.ai` (SETUP §3b) — `/api/bmai/status` ok,
      a request line in the journal shows `id_token=REDACTED`.
- [ ] `npm run tenants:reconcile` (dry-run) reviewed — the demo store reads `orphaned`;
      `--apply` run for our own dev stores only.
- [ ] Steps 3–8 pass; screenshots P01–P08 filed on #3718.
- [ ] **App version decision (one decision, not two).** `shopify app deploy` versions the app
      config together with the extensions: the same new version that activates the `domains/*`
      webhook subscriptions also releases this branch's `assistant.js` hardening. So either
      deploy both (needs the Shopify CLI + `shopify app config link`; required if step 6 ever
      shows the toggle on and saved with no launcher), or deploy neither and accept that a
      custom domain connected after install is repaired only on the next admin open or
      `tenants:reconcile`, not by webhook.
- [ ] **Protected customer data.** Open the draft (Partner Dashboard → API access requests →
      Protected customer data access → Manage): keep Protected customer data (Customer
      service, App functionality), Name and Address (Customer service); **add Phone** (Customer
      service — `update_shipping_address` writes the shipping phone; or drop `phone` from that
      tool's address input instead, one or the other); **deselect Email** (no tool uses it —
      data minimisation); re-read the 16 data-protection answers. The request is
      reviewed together with the listing when you resubmit.
- [ ] **New screencast (4.5.3):** install → Home → "Turn on the storefront assistant" → Save →
      "Ask us" answers in the Theme Editor → the storefront as an anonymous shopper → close and
      reopen, the embed still on and the launcher showing → uninstall + reinstall → it still
      works. Replace the screencast link in the submission.
- [ ] Testing instructions updated: step 2 must read "click **Save** in the theme editor (the
      embed stays on only after Save)"; add "Turn on the storefront assistant becomes available
      once your assistant can be shown (usually under a minute); the page checks by itself";
      add the 5.1.2 fix line.
- [ ] Owner's explicit go → Partner Dashboard → resubmit (not before 2026-10-08).
