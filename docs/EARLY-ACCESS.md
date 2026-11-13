# Early access sign-in on albena.ai (2026-11-13)

Omar: "make her login on albena.ai cause there are some with early access".

## How it works
- albena.ai header: **Sign in** -> `account.albena.ai/login` (staging site -> staging portal via `PUBLIC_PORTAL_ORIGIN`).
- Any sign-in (email link/code, passkey, Microsoft) now lands on **`/albena`** in the portal.
- `/albena` calls `GET /api/early-access` (session required) -> `{status, email, apps, source}`:
  - `granted`: buttons for chat.albena.ai, console.albena.ai, and `/downloads` (Mac/iPhone apps).
  - `waitlist`: "You're on the list" + **Request early access** (albena.ai/waitlist) + link to the account. No app links.
  - `unavailable`: the list could not be read (config missing, token bad, API down). **Fail closed.**
- Every check is audited (`earlyaccess.granted|waitlist|unavailable`), not in view-as.
- chat/console still enforce Cloudflare Access themselves; the portal page is the friendly front door, Access is the gate.

## One source of truth
The Cloudflare Access group **"Albena Early Access"** (account d59bc8ce…). The chat and console Access apps include the group (`link`), the portal reads the same group (read-only token, cached 60 s). Omar edits only the group, so they cannot drift.
- Portal evaluates `email` and `email_domain` include rules and `email` exclude rules. Other rule kinds (e.g. Azure/AD groups) are counted but never guessed; a person matched only by such a rule gets `waitlist` in the portal while Access may let them into chat.
- RBAC (docs ~/Claude/docs/OHLLC-RBAC.md): when SG-Albena-* groups exist in Entra, either add `@dbaomarhuertasllc.com` (L1 company) as an email_domain rule, or teach `parseGroup` to resolve azure rules via the RBAC `/api/me` block. The response already carries `source` so a later `rbac` field can be added without breaking clients.

## Admin (Omar)
`scripts/early-access.sh` with a Cloudflare API token (Access Groups Edit; Apps and Policies Edit for `link`):
```
read -s CLOUDFLARE_API_TOKEN; export CLOUDFLARE_API_TOKEN
scripts/early-access.sh create      # prints EARLY_ACCESS_GROUP_ID (seeded: omar, polina, chloe = today's chat list)
scripts/early-access.sh add someone@example.com      # or @domain
scripts/early-access.sh remove someone@example.com
scripts/early-access.sh list
scripts/early-access.sh link        # PRODUCTION: chat + console policies -> the group (same 3 people today)
```
Then put the group id into `portal/worker/wrangler.jsonc` `EARLY_ACCESS_GROUP_ID` (both envs) and set the read token (Access: Organizations, Identity Providers, and Groups **Read** only):
```
cd portal/worker && npx wrangler secret put CF_ACCESS_READ_TOKEN --env staging
```

## Files
- portal/worker/src/earlyaccess/index.ts (module, registered in modules.ts), test/earlyaccess.test.ts (6 tests; suite 322/322)
- portal/worker/src/types.ts (CF_ACCOUNT_ID, EARLY_ACCESS_GROUP_ID, CF_ACCESS_READ_TOKEN), wrangler.jsonc vars
- portal/worker/src/auth/{magic,microsoft}.ts + web/src/scripts/{login,check-email}.ts: post-login redirect `/albena`
- portal/web/src/pages/albena.astro, scripts/albena.ts, layouts/App.astro (nav "Open Albena")
- web/src/components/Nav.astro ("Sign in")
- scripts/early-access.sh

## Staging state
- Portal staging version 1836d1cf, site staging fc94964c (branch feat/early-access-signin). Both up (200).
- `/albena` shows `unavailable` until the group id + read token are set (verified with seeded staging test sessions `ea-test-allowed` / `ea-test-denied`, emails ea-allowed-test@example.com / ea-denied-test@example.com).
- To finish the test: create group, `add ea-allowed-test@example.com`, set the id + secret, redeploy staging, check both sessions, then `remove` the test email.
- Gotcha: a site staging deploy ran once with an empty dist (build needs PUBLIC_TURNSTILE_SITE_KEY); fixed ~1 min later.

## Rollback
Staging: `npx wrangler rollback --env staging` in portal/worker and worker/. Group: the chat/console policies can be put back to the 3 inline emails (ids in the script). Production untouched.
