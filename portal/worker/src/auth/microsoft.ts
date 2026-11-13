import type { Context, Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { AppEnv, Bindings } from "../types";
import { audit } from "../auditchain";
import { equalHash, randomToken, sha256 } from "./crypto";
import { allowed } from "./limits";
import { finishLogin } from "./login";
import { EMAIL_RE } from "./magic";

// Sign in with Microsoft (Entra ID, OIDC authorization code + PKCE). SINGLE TENANT ON PURPOSE: only our own Entra tenant
// (staff) may sign in, and the id_token is verified against that tenant's issuer and `tid`.
// Because the tenant is pinned, linking to an existing portal user by email is acceptable. A multi-tenant ("common"/"organizations")
// setup would need verified-email handling (the `email` claim is not guaranteed verified outside the home tenant), so do not widen this.
const COOKIE = "__Host-albena_oidc";
const cookieOptions = { httpOnly: true, secure: true, sameSite: "Lax" as const, path: "/", maxAge: 600 };
const SKEW_S = 300;
const JWKS_TTL_MS = 60 * 60 * 1000, JWKS_REFETCH_MS = 60 * 1000;
const FAILED = "/login?sso=failed";

type Config = { clientId: string; tenant: string; secret: string };
const config = (env: Bindings): Config | null =>
  env.ENTRA_CLIENT_ID && env.ENTRA_TENANT_ID && env.ENTRA_CLIENT_SECRET
    ? { clientId: env.ENTRA_CLIENT_ID, tenant: env.ENTRA_TENANT_ID, secret: env.ENTRA_CLIENT_SECRET } : null;
const authority = (tenant: string) => `https://login.microsoftonline.com/${encodeURIComponent(tenant)}`;
const redirectUri = (env: Bindings) => `${env.PORTAL_ORIGIN}/api/auth/microsoft/callback`;

const b64u = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string) => {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error("bad_base64url");
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, ch => ch.charCodeAt(0));
};
const sameString = async (a: string, b: string) => equalHash(await sha256(a), await sha256(b));

type Jwk = JsonWebKey & { kid?: string };
let jwksCache: { tenant: string; keys: Jwk[]; at: number } | null = null;
/** Test hook: forget cached signing keys. */
export function resetJwksCache(): void { jwksCache = null; }
async function signingKey(tenant: string, kid: string): Promise<Jwk | null> {
  const fresh = jwksCache && jwksCache.tenant === tenant && Date.now() - jwksCache.at < JWKS_TTL_MS;
  const hit = fresh ? jwksCache!.keys.find(k => k.kid === kid) : undefined;
  if (hit) return hit;
  // Unknown kid: refetch at most once a minute so a forged kid cannot make us hammer the JWKS endpoint.
  if (fresh && Date.now() - jwksCache!.at < JWKS_REFETCH_MS) return null;
  const res = await fetch(`${authority(tenant)}/discovery/v2.0/keys`);
  if (!res.ok) throw new Error("jwks_unavailable");
  const body = await res.json<{ keys?: Jwk[] }>();
  jwksCache = { tenant, keys: Array.isArray(body.keys) ? body.keys : [], at: Date.now() };
  return jwksCache.keys.find(k => k.kid === kid) ?? null;
}

/** Verifies an Entra id_token (RS256 only) and returns its claims. Throws a short reason code on any failure. */
async function verifyIdToken(token: string, cfg: Config, nonce: string): Promise<Record<string, unknown>> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed");
  const header = JSON.parse(new TextDecoder().decode(unb64u(parts[0]))) as { alg?: unknown; kid?: unknown };
  if (header.alg !== "RS256" || typeof header.kid !== "string") throw new Error("bad_alg");
  const jwk = await signingKey(cfg.tenant, header.kid);
  if (!jwk || jwk.kty !== "RSA") throw new Error("unknown_kid");
  const key = await crypto.subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, unb64u(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw new Error("bad_signature");
  const claims = JSON.parse(new TextDecoder().decode(unb64u(parts[1]))) as Record<string, unknown>;
  if (claims.iss !== `${authority(cfg.tenant)}/v2.0`) throw new Error("bad_iss");
  if (claims.aud !== cfg.clientId) throw new Error("bad_aud");
  if (claims.tid !== cfg.tenant) throw new Error("bad_tid");
  if (typeof claims.nonce !== "string" || !(await sameString(claims.nonce, nonce))) throw new Error("bad_nonce");
  const ts = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp < ts - SKEW_S) throw new Error("expired");
  if (claims.nbf !== undefined && (typeof claims.nbf !== "number" || claims.nbf > ts + SKEW_S)) throw new Error("not_yet_valid");
  return claims;
}

export function mountMicrosoft(app: Hono<AppEnv>): void {
  app.get("/api/auth/providers", c => c.json({ microsoft: config(c.env) !== null }));

  app.get("/api/auth/microsoft/start", async c => {
    if (!(await allowed(c))) return c.json({ error: "rate_limited" }, 429);
    const cfg = config(c.env);
    if (!cfg) return c.json({ error: "not_configured" }, 503);
    const state = randomToken(), nonce = randomToken(), verifier = randomToken();
    // The cookie binds the whole flow (state, nonce, PKCE verifier) to this browser; the callback must present all three.
    setCookie(c, COOKIE, `${state}.${nonce}.${verifier}`, cookieOptions);
    const challenge = b64u(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    const url = new URL(`${authority(cfg.tenant)}/oauth2/v2.0/authorize`);
    url.search = new URLSearchParams({
      client_id: cfg.clientId, response_type: "code", response_mode: "query", scope: "openid email profile",
      redirect_uri: redirectUri(c.env), code_challenge: challenge, code_challenge_method: "S256", state, nonce, prompt: "select_account",
    }).toString();
    return c.redirect(url.toString(), 302);
  });

  app.get("/api/auth/microsoft/callback", async c => {
    if (!(await allowed(c))) return c.json({ error: "rate_limited" }, 429);
    const fail = async (reason: string) => {
      deleteCookie(c, COOKIE, cookieOptions);
      await audit(c, "auth.microsoft.failed", reason);
      return c.redirect(FAILED, 303);
    };
    const cfg = config(c.env);
    if (!cfg) return fail("not_configured");
    const saved = (getCookie(c, COOKIE) ?? "").split(".");
    deleteCookie(c, COOKIE, cookieOptions);
    const [state, nonce, verifier] = saved;
    const hex = /^[a-f0-9]{64}$/;
    if (saved.length !== 3 || !hex.test(state) || !hex.test(nonce) || !hex.test(verifier)) return fail("no_flow");
    const queryState = c.req.query("state") ?? "";
    if (!(await sameString(queryState, state))) return fail("state_mismatch");
    if (c.req.query("error")) return fail("provider_error");
    const code = c.req.query("code") ?? "";
    if (!code || code.length > 4096) return fail("no_code");
    try {
      const res = await fetch(`${authority(cfg.tenant)}/oauth2/v2.0/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: cfg.clientId, client_secret: cfg.secret, code, redirect_uri: redirectUri(c.env),
          code_verifier: verifier, grant_type: "authorization_code",
        }),
      });
      if (!res.ok) return fail("token_exchange");
      const tokens = await res.json<{ id_token?: unknown }>();
      if (typeof tokens.id_token !== "string") return fail("no_id_token");
      const claims = await verifyIdToken(tokens.id_token, cfg, nonce);
      const raw = typeof claims.email === "string" ? claims.email : claims.preferred_username;
      const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
      if (email.length > 254 || !EMAIL_RE.test(email)) return fail("bad_email");
      await finishLogin(c, email, "microsoft");
      return c.redirect("/albena", 303);
    } catch (err) {
      // Reason codes only: never the token, the code or the error text (which can echo token fragments).
      return fail(err instanceof Error && /^[a-z_]+$/.test(err.message) ? err.message : "error");
    }
  });
}
