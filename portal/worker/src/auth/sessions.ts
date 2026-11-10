import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { AppEnv, User } from "../types";
import { randomToken, sha256 } from "./crypto";
import { audit } from "../auditchain";

export const SESSION_COOKIE = "__Host-albena_session";
export const IDLE_SECONDS = 12 * 60 * 60;
export const ABSOLUTE_SECONDS = 7 * 24 * 60 * 60;
export const VIEWAS_COOKIE = "__Host-albena_viewas";
export const VIEWAS_SECONDS = 30 * 60;
export const viewAsCookieOptions = { httpOnly: true, secure: true, sameSite: "Lax" as const, path: "/" };
/** Reads that must stay closed in a support view: PII exports, security data, and Stripe-backed links. */
const VIEWAS_DENIED_GET = [/^\/api\/account\/export$/, /^\/api\/security\//, /^\/api\/billing\/(portal|checkout|invoices)$/];
export const viewAsMayRun = (method: string, path: string) =>
  (method === "GET" || method === "HEAD") && !VIEWAS_DENIED_GET.some(r => r.test(path));
export const now = () => Math.floor(Date.now() / 1000);
const options = { httpOnly: true, secure: true, sameSite: "Lax" as const, path: "/" };
export function clearSession(c: Context<AppEnv>) { deleteCookie(c, SESSION_COOKIE, options); }
export type LoginMethod = "passkey" | "magic" | "microsoft";
export async function createSession(c: Context<AppEnv>, user: User, method: LoginMethod): Promise<void> {
  const token = randomToken(), id = crypto.randomUUID(), ts = now();
  const old = getCookie(c, SESSION_COOKIE);
  const statements = [];
  if (old) statements.push(c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(old)));
  statements.push(c.env.DB.prepare("INSERT INTO sessions (id, token_hash, user_id, account_id, created_at, last_seen, expires_at, login_method) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, await sha256(token), user.id, user.accountId, ts, ts, ts + ABSOLUTE_SECONDS, method));
  await c.env.DB.batch(statements);
  c.set("user", user);
  c.set("sessionId", id);
  setCookie(c, SESSION_COOKIE, token, { ...options, maxAge: ABSOLUTE_SECONDS });
}
/** Support view-as session. Returns a response to short-circuit, or undefined to fall through to the normal cookie. */
async function viewAsSession(c: Context<AppEnv>, vtoken: string): Promise<Response | "next" | undefined> {
  const ts = now();
  const row = /^[a-f0-9]{64}$/.test(vtoken) ? await c.env.DB.prepare(
    "UPDATE sessions SET last_seen = MAX(last_seen, ?) WHERE token_hash = ? AND view_as = 1 AND readonly = 1 AND expires_at > ? RETURNING id, user_id, account_id, actor, expires_at",
  ).bind(ts, await sha256(vtoken), ts).first<{ id: string; user_id: string; account_id: string; actor: string; expires_at: number }>() : null;
  const user = row ? await c.env.DB.prepare(
    "SELECT u.id, u.email, m.role, m.account_id AS accountId FROM users u JOIN members m ON m.user_id = u.id WHERE u.id = ? AND m.account_id = ?",
  ).bind(row.user_id, row.account_id).first<User>() : null;
  if (!row || !user) { deleteCookie(c, VIEWAS_COOKIE, viewAsCookieOptions); return undefined; }
  c.set("user", user);
  c.set("sessionId", row.id);
  c.set("supportActor", row.actor);
  c.set("viewAs", { actor: row.actor, expiresAt: row.expires_at });
  if (!viewAsMayRun(c.req.method, c.req.path)) {
    await audit(c, "support.view_as.denied_write", user.accountId, { method: c.req.method, path: c.req.path });
    return c.json({ error: "read_only_support_view" }, 403);
  }
  if (c.req.path.startsWith("/api/") && (c.req.method === "GET" || c.req.method === "HEAD")) await audit(c, "support.view_as.read", user.accountId, { path: c.req.path });
  return "next";
}
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const vtoken = getCookie(c, VIEWAS_COOKIE);
  if (vtoken) {
    const r = await viewAsSession(c, vtoken);
    if (r === "next") return next();
    if (r) return r;
  }
  const token = getCookie(c, SESSION_COOKIE);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return c.json({ error: "unauthorized" }, 401);
  const ts = now();
  // Conditional update checks expiry/revocation and refreshes idle time atomically.
  const session = await c.env.DB.prepare(
    "UPDATE sessions SET last_seen = MAX(last_seen, ?) WHERE token_hash = ? AND view_as = 0 AND last_seen > ? AND expires_at > ? RETURNING id, user_id, account_id, login_method",
  ).bind(ts, await sha256(token), ts - IDLE_SECONDS, ts).first<{ id: string; user_id: string; account_id: string; login_method: string | null }>();
  if (!session) { clearSession(c); return c.json({ error: "unauthorized" }, 401); }
  const user = await c.env.DB.prepare(
    "SELECT u.id, u.email, m.role, m.account_id AS accountId FROM users u JOIN members m ON m.user_id = u.id WHERE u.id = ? AND m.account_id = ?",
  ).bind(session.user_id, session.account_id).first<User>();
  if (!user) { clearSession(c); return c.json({ error: "unauthorized" }, 401); }
  c.set("user", user);
  c.set("sessionId", session.id);
  c.set("loginMethod", session.login_method === "passkey" || session.login_method === "microsoft" ? session.login_method : "magic");
  await next();
};
export async function userById(c: Context<AppEnv>, id: string): Promise<User | null> {
  // Default to owned account. Future account switching must validate membership.
  return c.env.DB.prepare("SELECT u.id, u.email, m.role, m.account_id AS accountId FROM users u JOIN members m ON m.user_id = u.id WHERE u.id = ? ORDER BY (m.role = 'owner') DESC, m.account_id LIMIT 1").bind(id).first<User>();
}
