import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ORIGIN, auditSince, client, e, lastAuditId, testBindings } from "./helpers";
import { resetJwksCache } from "../src/auth/microsoft";
import { SESSION_COOKIE } from "../src/auth/sessions";

const TENANT = "a4852d28-a73d-457b-87dc-d289eb20bf16", CLIENT = "client-id-123", KID = "test-kid";
const ISS = `https://login.microsoftonline.com/${TENANT}/v2.0`;
const bindings = () => testBindings({ ENTRA_TENANT_ID: TENANT, ENTRA_CLIENT_ID: CLIENT, ENTRA_CLIENT_SECRET: "shh-secret" });
const b64u = (b: ArrayBuffer | Uint8Array | string) => btoa(typeof b === "string" ? b : String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const rsa = () => crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]) as Promise<CryptoKeyPair>;

let good: CryptoKeyPair, other: CryptoKeyPair, jwks: unknown;
beforeAll(async () => {
  good = await rsa(); other = await rsa();
  jwks = { keys: [{ ...(await crypto.subtle.exportKey("jwk", good.publicKey)), kid: KID, use: "sig", alg: "RS256" }] };
});

async function jwt(claims: Record<string, unknown>, o: { key?: CryptoKeyPair; alg?: string; kid?: string } = {}) {
  const head = b64u(JSON.stringify({ alg: o.alg ?? "RS256", kid: o.kid ?? KID, typ: "JWT" })), body = b64u(JSON.stringify(claims));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", (o.key ?? good).privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64u(sig)}`;
}
const claimsFor = (nonce: string, over: Record<string, unknown> = {}) => {
  const t = Math.floor(Date.now() / 1000);
  return { iss: ISS, aud: CLIENT, tid: TENANT, nonce, iat: t, nbf: t, exp: t + 3600, email: "Staff.Person@Example.com", ...over };
};

let tokenResponse: () => Response, fetchCalls: { url: string; body?: string }[];
beforeEach(() => {
  resetJwksCache(); fetchCalls = [];
  tokenResponse = () => new Response(JSON.stringify({}), { status: 400 });
  vi.stubGlobal("fetch", vi.fn(async (input: any, init: any = {}) => {
    const url = String(input);
    fetchCalls.push({ url, body: init.body?.toString() });
    if (url === `https://login.microsoftonline.com/${TENANT}/discovery/v2.0/keys`) return new Response(JSON.stringify(jwks));
    if (url === `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`) return tokenResponse();
    return new Response("unmocked", { status: 500 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

const cookieOf = (r: Response, name: string) => r.headers.getSetCookie().find(c => c.startsWith(name + "="));
/** Runs /start and returns the browser cookie plus the state/nonce Microsoft would echo back. */
async function begin() {
  const r = await client(undefined, bindings()).request("/api/auth/microsoft/start");
  const loc = new URL(r.headers.get("location")!);
  return { r, loc, cookie: cookieOf(r, "__Host-albena_oidc")!.split(";")[0], state: loc.searchParams.get("state")!, nonce: loc.searchParams.get("nonce")! };
}
const callback = (qs: Record<string, string>, cookie?: string) =>
  client(cookie, bindings()).request("/api/auth/microsoft/callback?" + new URLSearchParams(qs), {}, bindings());
const failed = (r: Response) => { expect(r.status).toBe(303); expect(r.headers.get("location")).toBe("/login?sso=failed"); };
async function expectFailureAudit(since: number, reason: string) {
  const rows = (await auditSince(since)).filter(a => a.action === "auth.microsoft.failed");
  expect(rows.map(a => a.target)).toEqual([reason]);
}

describe("providers", () => {
  it("is off without config", async () => {
    const r = await client().request("/api/auth/providers");
    expect(await r.json()).toEqual({ microsoft: false });
  });
  it("is off when the client id is empty or the secret missing", async () => {
    for (const over of [{ ENTRA_CLIENT_ID: "" }, { ENTRA_CLIENT_SECRET: undefined }]) {
      const r = await client().request("/api/auth/providers", {}, { ...bindings(), ...over });
      expect(await r.json()).toEqual({ microsoft: false });
    }
  });
  it("is on when fully configured", async () => {
    expect(await (await client().request("/api/auth/providers", {}, bindings())).json()).toEqual({ microsoft: true });
  });
});

describe("start", () => {
  it("503s when not configured", async () => {
    expect((await client().request("/api/auth/microsoft/start")).status).toBe(503);
  });
  it("sets the flow cookie and redirects to Entra with PKCE", async () => {
    const { r, loc, cookie, state, nonce } = await begin();
    expect(r.status).toBe(302);
    expect(loc.origin + loc.pathname).toBe(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`);
    const p = loc.searchParams;
    expect(Object.fromEntries(p)).toMatchObject({
      client_id: CLIENT, response_type: "code", response_mode: "query", scope: "openid email profile",
      redirect_uri: `${ORIGIN}/api/auth/microsoft/callback`, code_challenge_method: "S256", prompt: "select_account",
    });
    const [cState, cNonce, verifier] = decodeURIComponent(cookie.split("=")[1]).split(".");
    expect([cState, cNonce]).toEqual([state, nonce]);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    expect(p.get("code_challenge")).toBe(b64u(digest));
    const header = cookieOf(r, "__Host-albena_oidc")!;
    expect(header).toMatch(/HttpOnly/i); expect(header).toMatch(/Secure/i); expect(header).toMatch(/SameSite=Lax/i);
    expect(header).toMatch(/Path=\//); expect(header).toMatch(/Max-Age=600/);
  });
  it("is rate limited", async () => {
    const b = bindings(); (b.AUTH_IP_LIMITER.limit as any).mockResolvedValue({ success: false });
    expect((await client().request("/api/auth/microsoft/start", {}, b)).status).toBe(429);
  });
});

describe("callback", () => {
  const exchange = (idToken: string) => { tokenResponse = () => new Response(JSON.stringify({ id_token: idToken, access_token: "at" })); };

  it("rejects a missing cookie, a wrong state, and provider errors", async () => {
    let since = await lastAuditId();
    failed(await callback({ code: "c", state: "x" }));
    await expectFailureAudit(since, "no_flow");
    const f = await begin();
    since = await lastAuditId();
    const r = await callback({ code: "c", state: "0".repeat(64) }, f.cookie);
    failed(r); expect(cookieOf(r, "__Host-albena_oidc")).toMatch(/Max-Age=0|Expires=/i);
    await expectFailureAudit(since, "state_mismatch");
    const g = await begin();
    since = await lastAuditId();
    failed(await callback({ error: "access_denied", state: g.state }, g.cookie));
    await expectFailureAudit(since, "provider_error");
    expect(fetchCalls.filter(c => c.url.includes("/token"))).toHaveLength(0);
  });

  it("rejects a bad token exchange", async () => {
    const f = await begin(); const since = await lastAuditId();
    failed(await callback({ code: "c", state: f.state }, f.cookie));
    await expectFailureAudit(since, "token_exchange");
  });

  const bad: [string, (n: string) => Promise<string>, string][] = [
    ["bad signature", n => jwt(claimsFor(n), { key: other }), "bad_signature"],
    ["HS256 alg", n => jwt(claimsFor(n), { alg: "HS256" }), "bad_alg"],
    ["none alg", n => jwt(claimsFor(n), { alg: "none" }), "bad_alg"],
    ["unknown kid", n => jwt(claimsFor(n), { kid: "nope" }), "unknown_kid"],
    ["wrong iss", n => jwt(claimsFor(n, { iss: "https://login.microsoftonline.com/other/v2.0" })), "bad_iss"],
    ["wrong aud", n => jwt(claimsFor(n, { aud: "someone-else" })), "bad_aud"],
    ["wrong tid", n => jwt(claimsFor(n, { tid: "9bbbbbbb-0000-0000-0000-000000000000" })), "bad_tid"],
    ["wrong nonce", () => jwt(claimsFor("f".repeat(64))), "bad_nonce"],
    ["expired", n => jwt(claimsFor(n, { exp: Math.floor(Date.now() / 1000) - 400 })), "expired"],
    ["not yet valid", n => jwt(claimsFor(n, { nbf: Math.floor(Date.now() / 1000) + 400 })), "not_yet_valid"],
    ["no usable email", n => jwt(claimsFor(n, { email: undefined, preferred_username: "not an email" })), "bad_email"],
  ];
  it.each(bad)("rejects %s", async (_name, make, reason) => {
    const f = await begin(); const since = await lastAuditId();
    exchange(await make(f.nonce));
    const r = await callback({ code: "c", state: f.state }, f.cookie);
    failed(r);
    expect(cookieOf(r, SESSION_COOKIE)).toBeUndefined();
    await expectFailureAudit(since, reason);
    // No PII or tokens in the audit trail.
    const rows = await e.DB.prepare("SELECT target, meta FROM audit_log WHERE id > ?").bind(since).all();
    expect(JSON.stringify(rows.results)).not.toMatch(/example\.com|eyJ/);
  });

  it("accepts a token within clock skew", async () => {
    const f = await begin();
    exchange(await jwt(claimsFor(f.nonce, { exp: Math.floor(Date.now() / 1000) - 200 })));
    expect((await callback({ code: "c", state: f.state }, f.cookie)).headers.get("location")).toBe("/");
  });

  it("signs in: creates the user, session and audit entry, sends the right token request", async () => {
    const f = await begin(); const since = await lastAuditId();
    exchange(await jwt(claimsFor(f.nonce)));
    const r = await callback({ code: "the-code", state: f.state }, f.cookie);
    expect(r.status).toBe(303); expect(r.headers.get("location")).toBe("/");
    const sess = cookieOf(r, SESSION_COOKIE)!;
    expect(sess).toBeDefined();
    const form = new URLSearchParams(fetchCalls.find(c => c.url.endsWith("/oauth2/v2.0/token"))!.body);
    expect(Object.fromEntries(form)).toMatchObject({ client_id: CLIENT, client_secret: "shh-secret", code: "the-code", grant_type: "authorization_code", redirect_uri: `${ORIGIN}/api/auth/microsoft/callback` });
    const verifier = decodeURIComponent(f.cookie.split("=")[1]).split(".")[2];
    expect(form.get("code_verifier")).toBe(verifier);

    const user = await e.DB.prepare("SELECT id FROM users WHERE email = ?").bind("staff.person@example.com").first<{ id: string }>();
    expect(user).not.toBeNull();
    const row = await e.DB.prepare("SELECT login_method FROM sessions WHERE user_id = ?").bind(user!.id).first<{ login_method: string }>();
    expect(row?.login_method).toBe("microsoft");
    expect((await auditSince(since)).map(a => a.action)).toContain("auth.login.microsoft");

    const me = await client(sess.split(";")[0], bindings()).request("/api/me");
    expect(((await me.json()) as any).user.email).toBe("staff.person@example.com");
    const hist = await client(sess.split(";")[0], bindings()).request("/api/security/history");
    expect(((await hist.json()) as any).events[0].method).toBe("microsoft");
  });

  it("falls back to preferred_username and links an existing user", async () => {
    const id = crypto.randomUUID(), email = `${id}@example.com`;
    await e.DB.batch([
      e.DB.prepare("INSERT INTO users (id,email) VALUES (?,?)").bind(id, email),
      e.DB.prepare("INSERT INTO accounts (id,owner) VALUES (?,?)").bind(id, id),
      e.DB.prepare("INSERT INTO members (account_id,user_id,role) VALUES (?,?,'owner')").bind(id, id),
    ]);
    const f = await begin();
    exchange(await jwt(claimsFor(f.nonce, { email: undefined, preferred_username: email.toUpperCase() })));
    expect((await callback({ code: "c", state: f.state }, f.cookie)).headers.get("location")).toBe("/");
    const n = await e.DB.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND login_method = 'microsoft'").bind(id).first<{ n: number }>();
    expect(n?.n).toBe(1);
  });

  it("cannot replay a flow: the cookie is cleared on first use", async () => {
    const f = await begin();
    exchange(await jwt(claimsFor(f.nonce)));
    const first = await callback({ code: "c", state: f.state }, f.cookie);
    expect(cookieOf(first, "__Host-albena_oidc")).toMatch(/Max-Age=0|Expires=/i);
  });
});
