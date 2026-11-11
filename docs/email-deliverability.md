# Email deliverability runbook (albena.ai)

The portal sends sign-in codes/links, pilot invites and household invites through the Cloudflare Email Sending binding `EMAIL` (`portal/worker/src/auth/mail.ts`, composition in `auth/compose.ts`). All are transactional.

## What the code does
- Multipart `text/plain` + inline-CSS HTML; no remote images, scripts, trackers or shorteners; every href equals the plain-text URL shown beside it.
- From `Albena <accounts@albena.ai>`, Reply-To `accounts@albena.ai` (change `REPLY_TO` in `mail.ts` once `support@albena.ai` has a mailbox).
- Message-ID is assigned by Cloudflare on our sending domain (the headers allowlist does not let us set it; do not try, it returns `E_HEADER_NOT_ALLOWED`).
- No `List-Unsubscribe`: sign-in and invites are transactional. Add it (HTTPS one-click) only if non-transactional mail is ever sent.
- Plain subjects, no emoji/caps/exclamation marks. Invite names who invited and why; every mail has an expiry line, a "didn't request this?" line and the identity line (`SENDER_IDENTITY` in `compose.ts`).
- **TODO Omar:** replace `[City, ST ZIP]` in `SENDER_IDENTITY` with the real mailing address.

## 0. Role mailboxes (ALB-OPS-1)
`support@` (plus `accounts@`, `billing@`) route to the `albena-inbound-mail` Worker (Obvera tickets). `security@` and `privacy@` forward to the owner via Cloudflare Email Routing: run `scripts/setup-role-mailboxes.sh` after the destination address is verified. These addresses are published in `security.txt`, the privacy policy and the support page.

## 1. Check DNS
`scripts/mail_check.sh [domain] [bounce-subdomain]` prints PASS/FAIL for MX/SPF on `cf-bounce.albena.ai`, DKIM, DMARC and root SPF.

## 2. DNS changes to apply (lead)
1. **DMARC reporting address.** Replace the GoDaddy leftover. Easiest: Cloudflare dashboard > Email > DMARC Management > enable for albena.ai. It gives an `rua=mailto:...@dmarc-reports.cloudflare.net` address and a weekly digest. Then set `_dmarc.albena.ai` TXT to
   `v=DMARC1; p=quarantine; adkim=r; aspf=r; pct=100; rua=mailto:<address shown by DMARC Management>`
   (There is no dmarc@albena.ai mailbox; do not use it until one exists.)
2. **Root SPF** (apex sends no mail): `albena.ai` TXT `v=spf1 -all`. If a GoDaddy/Microsoft mail plan is added later, change to `v=spf1 include:<provider> -all`.
3. Later, once reports are clean for 2-4 weeks: `p=reject`.

## 3. Reputation tools (one-off setup)
- **Google Postmaster Tools** (postmaster.google.com): add `albena.ai`, add the TXT verification record it shows, wait for data (needs steady Gmail volume). Watch domain reputation, spam rate, auth pass rates.
- **Microsoft SNDS / JMRP** (sendersupport.office.com, sign in with a Microsoft account): SNDS needs sending IPs, which are Cloudflare's shared pool, so it has limited value; Outlook.com problems go through the sender support form.
- **mail-tester.com**: open the site, copy the one-time address, request a sign-in email to it from the portal (rate limited to 5/min), read the score. Aim 9/10+. Fix anything under SPF/DKIM/DMARC first.

## 4. Warm-up and behaviour
- Keep volume low and steady at first (pilot scale: a handful per day); don't blast invites in bulk.
- Send only to real addresses you control or that expect the mail; bounces and complaints damage the shared reputation. Remove bounced addresses.
- Ask pilot users to reply, star the message or move it to the inbox. Real engagement is the strongest signal.
- If it lands in spam: in Gmail click "Not spam" then add accounts@albena.ai to contacts; in Outlook "Not junk" > "Add to safe senders"; for Proofpoint-protected domains ask the recipient's IT to allowlist `albena.ai` / `cf-bounce.albena.ai`.

## 5. BIMI (optional, later)
Needs DMARC at `p=quarantine`/`reject` with `pct=100`, an SVG Tiny PS logo, and for Gmail's checkmark a VMC/CMC certificate (paid). Low priority for a pilot.

## 6. Troubleshooting
View headers of a received message (Gmail: Show original) and confirm `SPF: PASS`, `DKIM: PASS`, `DMARC: PASS`. Re-run `scripts/mail_check.sh` after any DNS change.
