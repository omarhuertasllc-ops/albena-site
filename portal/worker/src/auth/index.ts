import type { Hono } from "hono";
import type { AppEnv } from "../types";
import { audit } from "../auditchain";
import { mountMagic } from "./magic";
import { mountMicrosoft } from "./microsoft";
import { mountPasskeys } from "./passkeys";
import { requireUser, clearSession, now, IDLE_SECONDS } from "./sessions";
export { requireUser } from "./sessions";
export { audit } from "../auditchain";
export type { AppEnv } from "../types";
export const migrations = ["0100_auth_core.sql", "0101_auth_audit_actor.sql", "0102_magic_code.sql", "0103_magic_code_failures.sql"];

export function mount(app: Hono<AppEnv>): void {
  mountMagic(app);
  mountPasskeys(app);
  mountMicrosoft(app);
  app.get("/api/me", requireUser, c => c.json({ user: c.get("user"), ...(c.get("viewAs") ? { viewAs: c.get("viewAs") } : {}) }));
  app.post("/api/auth/logout", requireUser, async c => {
    await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(c.get("sessionId")).run();
    clearSession(c);
    await audit(c, "auth.logout", c.get("user").id);
    return c.json({ ok: true });
  });
  app.get("/api/security/sessions", requireUser, async c => {
    const ts = now();
    const { results } = await c.env.DB.prepare("SELECT id, created_at AS createdAt, last_seen AS lastSeen, expires_at AS expiresAt FROM sessions WHERE user_id = ? AND view_as = 0 AND last_seen > ? AND expires_at > ? ORDER BY created_at DESC")
      .bind(c.get("user").id, ts - IDLE_SECONDS, ts).all<{ id: string }>();
    return c.json({ sessions: results.map(s => ({ ...s, current: s.id === c.get("sessionId") })) });
  });
  app.delete("/api/security/sessions/:id", requireUser, async c => {
    const id = c.req.param("id");
    const deleted = await c.env.DB.prepare("DELETE FROM sessions WHERE id = ? AND user_id = ? RETURNING id")
      .bind(id, c.get("user").id).first();
    if (!deleted) return c.json({ error: "not_found" }, 404);
    if (id === c.get("sessionId")) clearSession(c);
    await audit(c, "auth.session.revoke", id);
    return c.json({ ok: true });
  });
  // Sign-in history comes from the audit chain (successful sign-ins only; failures are not attributable to a user).
  app.get("/api/security/history", requireUser, async c => {
    const { results } = await c.env.DB.prepare(
      "SELECT ts AS at, action FROM audit_log WHERE actor = ? AND action IN ('auth.login.passkey','auth.login.magic','auth.login.microsoft') ORDER BY id DESC LIMIT 50",
    ).bind(c.get("user").id).all<{ at: string; action: string }>();
    return c.json({ events: results.map(r => ({ at: r.at, method: r.action === "auth.login.passkey" ? "passkey" : r.action === "auth.login.microsoft" ? "microsoft" : "magic_link" })) });
  });
  app.get("/api/security/passkeys", requireUser, async c => {
    const { results } = await c.env.DB.prepare("SELECT id, created_at AS createdAt FROM passkeys WHERE user_id = ? ORDER BY created_at DESC")
      .bind(c.get("user").id).all();
    return c.json({ passkeys: results });
  });
  // Removing the last passkey is allowed: the email magic link is always available as a sign-in method.
  app.delete("/api/security/passkeys/:id", requireUser, async c => {
    const id = c.req.param("id");
    const deleted = await c.env.DB.prepare("DELETE FROM passkeys WHERE id = ? AND user_id = ? RETURNING id").bind(id, c.get("user").id).first();
    if (!deleted) return c.json({ error: "not_found" }, 404);
    // A removed credential may have been the attacker's: end every other session, keep this one.
    await c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND id <> ?").bind(c.get("user").id, c.get("sessionId")).run();
    await audit(c, "auth.passkey.remove", c.get("user").id);
    return c.json({ ok: true });
  });
}
