# Albena portal Worker

Branch-only auth implementation for `account.albena.ai`. No resources are provisioned by this repository. `DB` is a separate D1 database; its ID remains `TO_BE_CREATED`.

Run from this directory:

```sh
npm install
npm run typecheck
npm test
```

Tests use real local D1 through `@cloudflare/vitest-plugin`; mail and WebAuthn verification are mocked. Production uses `@simplewebauthn/server` to verify signatures, RP ID, origin, challenge and required user verification. See [SimpleWebAuthn 13.2 documentation](https://simplewebauthn.dev/docs/13.2.x/packages/server).

## Integration

- `src/index.ts` exports `AppEnv`, `requireUser`, and `audit`. Auth also re-exports them; `src/audit.ts` is a stable audit import.
- Modules (auth, billing, hubs, account) are registered statically in `src/modules.ts`.
- `/api/me` returns `{ user: { id, email, role, accountId } }`. Session listing returns `{ sessions: [{ id, createdAt, lastSeen, expiresAt, current }] }`; dates are epoch seconds and IDs are nonsecret handles.
- Browser writes require `X-Requested-With: albena-portal`; supplied Origin must match `PORTAL_ORIGIN`. No CORS is enabled. Stripe webhook and hub pair-complete/heartbeat are exempt **only** because their modules must validate signatures/device credentials themselves. They are 404 until mounted.
- Turnstile widgets must set action `magic_login`. Start accepts `{ email, turnstileToken }` and returns 202 independently of user existence, delivery failure or email throttling.
- Magic links expire in 15 minutes and must open in the initiating browser (HttpOnly browser-binding cookie). Verification redirects to `/` with 303 to remove the token from the visible destination. Do not enable request URL logging or analytics on the verification endpoint. An email scanner without the binding cookie cannot consume the link.
- Passkey options endpoints return options directly. Verify endpoints take the raw browser `RegistrationResponseJSON` / `AuthenticationResponseJSON`. The server keeps the challenge and binds it to an HttpOnly cookie; registration is additionally bound to user and session. A new options request replaces the browser's previous ceremony. Login uses discoverable credentials with required user verification; no email lookup endpoint.
- Sessions rotate at login, expire after 12 hours idle or 7 days absolute, and are stored only as SHA-256 hashes. Revocation targets the nonsecret session row ID and is scoped to the authenticated user.
- `accounts.owner` references `users.id`; `members` uses `(account_id, user_id, role)`. First verified magic login provisions an owned account. Invitations, account switching, export and account deletion are outside this auth assignment.
- Audit rows are hash chained, including metadata, with append-only content guards. Never pass secrets or raw personal data to `audit` metadata. Hash chains detect edits but do not replace externally retained backups.

## Lead provisioning decisions (no deployment performed)

Set `TURNSTILE_SECRET_KEY` and `PORTAL_SECRETS` (random HMAC privacy key) as Worker secrets. Keep `PORTAL_ORIGIN=https://account.albena.ai` and `RP_ID=albena.ai`.

Sign in with Microsoft (optional, staff only): Entra app registration in the single tenant `a4852d28-a73d-457b-87dc-d289eb20bf16`, web redirect URI `${PORTAL_ORIGIN}/api/auth/microsoft/callback` (one per environment). Put the app's client id in the `ENTRA_CLIENT_ID` var and its client secret in the Worker secret `ENTRA_CLIENT_SECRET` (`wrangler secret put ENTRA_CLIENT_SECRET [--env staging]`). The login button appears only when all three are set. Single tenant is deliberate; multi-tenant would need verified-email handling.

Mail transport is chosen by `MAIL_PROVIDER`: `cloudflare` (Email Sending `send_email` binding `EMAIL`; onboard the sender domain first) or `dev` (non-production only). See HANDOFF.md.

Before production: create the D1 database and apply migrations, set secrets (`TURNSTILE_SECRET_KEY`, `PORTAL_SECRETS`, `ENTRA_CLIENT_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`), fill the `PRICE_*` vars with Stripe test price ids, build `portal/web` (the worker serves `../web/dist`), and establish D1 recovery/backups. API reference: ../CONTRACT.md.
