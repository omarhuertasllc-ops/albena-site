# Portal delivery pipeline (dev -> staging -> production)

Scope: the portal (`portal/web` + `portal/worker`, served at account.albena.ai). The marketing worker (`worker/`, albena.ai) still deploys from the `deploy` job in `ci.yml`.

| Stage | Where | Trigger |
|---|---|---|
| dev | local (`wrangler dev --local`, `migrate:local`) and PR checks in `ci.yml` | every PR / push |
| staging | worker `albena-portal-staging`, D1 `albena_portal_staging` | push to `main` touching `portal/**` (job `deploy-staging` in `deploy.yml`) |
| production | worker `albena-portal`, D1 `albena_portal`, account.albena.ai | after staging passes, **manual approval** (GitHub environment `production`) |

Flow in `deploy.yml`: `verify` (typecheck, tests, build + guard) -> `deploy-staging` (build with staging site key, guard, D1 migrations, deploy, smoke) -> approval -> `deploy-prod` (build with prod site key, guard, migrations, deploy, smoke, **auto `wrangler rollback` if smoke fails**).

## Build guard

`portal/scripts/check-portal-build.mjs` exists because one deploy shipped a dist built without `PUBLIC_TURNSTILE_SITE_KEY` and `/login`, `/`, `/invite` returned 404.

- `ci` mode (PR checks, `npm run check:build` in `portal/web`): dist contains `index.html`, `login.html`, `invite.html` and a Turnstile `data-sitekey` is baked in (Cloudflare test key allowed).
- `deploy` mode (`npm run check:build:deploy`): additionally `PUBLIC_TURNSTILE_SITE_KEY` must be set, must not be a test key, `ALBENA_ALLOW_TEST_TURNSTILE` must not be `1`, and the key in the built pages must equal it.
- Local deploys: `cd portal/worker && npm run deploy` runs the guard first (`predeploy`); `npm run deploy:staging` also runs it. Build first with the real key: `cd portal/web && PUBLIC_TURNSTILE_SITE_KEY=<key> npm run build`.

## Smoke test

`portal/scripts/smoke-portal.sh <url>`: `/`, `/login`, `/invite` -> 200 and `/api/me` -> 401, with retries for propagation.

## GitHub configuration needed (not done by this PR)

Environments (Settings -> Environments): `staging` (no reviewers) and `production` (**Required reviewers: Omar**, restrict to branch `main`).

Environment secrets (set on BOTH environments; use a separate, narrower token for staging if you prefer):

| Name | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Token with Workers Scripts:Edit, D1:Edit, Workers Routes/Custom Domains for albena.ai (prod) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account id |

Environment variables (different value per environment):

| Name | staging | production |
|---|---|---|
| `TURNSTILE_SITE_KEY` | a real (non-test) site key whose hostnames include the staging workers.dev host | the production site key (same as the marketing `TURNSTILE_SITE_KEY`) |
| `PORTAL_URL` | `https://albena-portal-staging.<subdomain>.workers.dev` | `https://account.albena.ai` |

Note: the portal verifies the Turnstile token hostname against `PORTAL_ORIGIN`, so the staging site key and secret must allow the staging hostname.

## One-time Cloudflare staging setup (run by Omar; nothing is created by the PR)

```sh
cd portal/worker
npx wrangler login                                  # or export CLOUDFLARE_API_TOKEN

# 1. Staging database. Copy the printed database_id into env.staging.d1_databases in wrangler.jsonc (replace TODO-STAGING-D1-ID).
npx wrangler d1 create albena_portal_staging

# 2. First deploy creates the worker and its workers.dev URL. Use a build made with the staging site key.
(cd ../web && npm ci && PUBLIC_TURNSTILE_SITE_KEY=<staging-site-key> npm run build)
npx wrangler d1 migrations apply albena_portal_staging --env staging --remote
npx wrangler deploy --env staging
#    Put the resulting host into env.staging.vars PORTAL_ORIGIN and RP_ID (replace TODO-SUBDOMAIN), commit, redeploy.

# 3. Staging secrets (use staging/test values, never production secrets).
npx wrangler secret put TURNSTILE_SECRET_KEY --env staging
npx wrangler secret put PORTAL_SECRETS --env staging      # random HMAC privacy key
npx wrangler secret put ENTRA_CLIENT_SECRET --env staging # optional: Sign in with Microsoft (also set the ENTRA_CLIENT_ID var)
npx wrangler secret put STRIPE_SECRET_KEY --env staging   # sk_test_ only
npx wrangler secret put STRIPE_WEBHOOK_SECRET --env staging
# Optional (view-as): TEAM_DOMAIN, ADMIN_AUD, SUPPORT_ADMIN_EMAILS

# 4. Turnstile: add the staging workers.dev hostname to the staging widget.
```

`env.staging` uses `ENVIRONMENT=test` and `MAIL_PROVIDER=dev`, so staging never sends real mail. Magic-link sign-in on staging therefore needs a test hook or Access; smoke tests only check page and 401 behaviour.
The deploy job refuses to run while `wrangler.jsonc` still contains `TODO`.

## Caveats

- D1 migrations run before the worker deploy and cannot be rolled back by `wrangler rollback`. Keep migrations backward compatible (add columns/tables first, remove in a later release).
- `wrangler rollback` returns to the previous worker version; it is automatic only on production smoke failure.
- Required status checks / branch protection stay as configured in `scripts/apply-github-protections.sh`.
