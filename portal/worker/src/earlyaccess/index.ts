import type { Hono } from "hono";
import type { AppEnv, Bindings } from "../types";
import { requireUser } from "../auth/sessions";
import { audit } from "../auditchain";

// Early access to Albena (chat.albena.ai, console.albena.ai, app downloads).
// ONE source of truth: the Cloudflare Access group EARLY_ACCESS_GROUP_ID ("Albena Early Access"). The chat and console
// Access apps include the same group, so the portal and Access can never drift. Omar edits the group (Zero Trust
// dashboard or scripts/early-access.sh); the portal only reads it with a read-only token. Fail closed.
// RBAC: the group is L0-L3 agnostic. When SG-Albena-* groups exist (Entra/AD sync), add them to the Access group as
// `azure` rules; the portal then answers `unavailable` for people it cannot evaluate itself (see docs/EARLY-ACCESS.md).

export const migrations: string[] = [];
export const APPS = [
  { id: "chat", name: "Albena chat", href: "https://chat.albena.ai" },
  { id: "console", name: "Albena console", href: "https://console.albena.ai" },
  { id: "downloads", name: "Mac and iPhone apps", href: "/downloads" },
] as const;

type Rule = Record<string, Record<string, unknown> | undefined>;
export interface Allowlist { emails: Set<string>; domains: Set<string>; deny: Set<string>; unsupported: number }
const TTL_MS = 60_000;
let cache: { key: string; at: number; list: Allowlist } | undefined;
export const resetCache = () => { cache = undefined; };

/** Turns Access group rules into what the portal can evaluate: email and email_domain. Other rule kinds are counted, never guessed. */
export function parseGroup(group: { include?: Rule[]; exclude?: Rule[] }): Allowlist {
  const out: Allowlist = { emails: new Set(), domains: new Set(), deny: new Set(), unsupported: 0 };
  for (const r of group.include ?? []) {
    const e = r.email?.email, d = r.email_domain?.domain;
    if (typeof e === "string") out.emails.add(e.trim().toLowerCase());
    else if (typeof d === "string") out.domains.add(d.trim().toLowerCase().replace(/^@/, ""));
    else out.unsupported++;
  }
  for (const r of group.exclude ?? []) {
    const e = r.email?.email;
    if (typeof e === "string") out.deny.add(e.trim().toLowerCase());
  }
  return out;
}

export function allowed(list: Allowlist, email: string): boolean {
  const e = email.toLowerCase(), domain = e.split("@")[1] ?? "";
  if (list.deny.has(e)) return false;
  return list.emails.has(e) || (domain !== "" && list.domains.has(domain));
}

export async function loadAllowlist(env: Bindings, fetcher: typeof fetch = fetch): Promise<Allowlist | null> {
  const acct = env.CF_ACCOUNT_ID, group = env.EARLY_ACCESS_GROUP_ID, token = env.CF_ACCESS_READ_TOKEN;
  if (!acct || !group || !token) return null;
  const key = `${acct}/${group}`;
  if (cache && cache.key === key && Date.now() - cache.at < TTL_MS) return cache.list;
  try {
    const res = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${acct}/access/groups/${group}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const body = await res.json<{ success?: boolean; result?: { include?: Rule[]; exclude?: Rule[] } }>();
    if (!body.success || !body.result) return null;
    const list = parseGroup(body.result);
    cache = { key, at: Date.now(), list };
    return list;
  } catch { return null; }
}

export function mount(app: Hono<AppEnv>): void {
  // status: granted (apps listed) | waitlist (signed in, not on the list) | unavailable (list could not be read: fail closed).
  app.get("/api/early-access", requireUser, async c => {
    const user = c.get("user");
    const list = await loadAllowlist(c.env);
    const status = !list ? "unavailable" : allowed(list, user.email) ? "granted" : "waitlist";
    if (!c.get("viewAs")) await audit(c, `earlyaccess.${status}`, user.id).catch(() => {});
    return c.json({ status, email: user.email, apps: status === "granted" ? APPS : [], source: "cloudflare_access_group" });
  });
}
