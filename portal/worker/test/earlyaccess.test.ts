import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { client, login, seedOwner, testBindings } from "./helpers";
import { allowed, parseGroup, resetCache } from "../src/earlyaccess";

const GROUP = { include: [{ email: { email: "Listed@Example.com" } }, { email_domain: { domain: "team.example" } }, { azure: { id: "g" } }], exclude: [{ email: { email: "blocked@team.example" } }] };
const cfg = { CF_ACCOUNT_ID: "acct", EARLY_ACCESS_GROUP_ID: "grp", CF_ACCESS_READ_TOKEN: "tok" };
let calls = 0, reply: () => Response;
beforeEach(() => {
  resetCache(); calls = 0;
  reply = () => Response.json({ success: true, result: GROUP });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls++;
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acct/access/groups/grp");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    return reply();
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe("allowlist parsing", () => {
  it("reads email + domain rules, excludes, and counts the rest", () => {
    const l = parseGroup(GROUP);
    expect(allowed(l, "listed@example.com")).toBe(true);
    expect(allowed(l, "anyone@team.example")).toBe(true);
    expect(allowed(l, "blocked@team.example")).toBe(false);
    expect(allowed(l, "stranger@example.com")).toBe(false);
    expect(allowed(l, "x@notteam.example")).toBe(false);
    expect(l.unsupported).toBe(1);
  });
});

describe("GET /api/early-access", () => {
  it("needs a session", async () => {
    expect((await client(undefined, testBindings(cfg)).request("/api/early-access")).status).toBe(401);
  });
  it("grants a listed user and lists the apps", async () => {
    const u = await seedOwner("listed");
    const r = await client(await login(u), testBindings(cfg)).request("/api/early-access");
    const b = await r.json<{ status: string; apps: { id: string }[] }>();
    expect(b.status).toBe("granted");
    expect(b.apps.map(a => a.id)).toEqual(["chat", "console", "downloads"]);
  });
  it("puts everyone else on the list, with no apps", async () => {
    const u = await seedOwner("stranger");
    const b = await (await client(await login(u), testBindings(cfg)).request("/api/early-access")).json<{ status: string; apps: unknown[] }>();
    expect(b).toMatchObject({ status: "waitlist", apps: [] });
  });
  it("fails closed without config or when Cloudflare errors", async () => {
    const u = await seedOwner("listed");
    const cookie = await login(u);
    expect((await (await client(cookie, testBindings()).request("/api/early-access")).json<{ status: string }>()).status).toBe("unavailable");
    reply = () => new Response("no", { status: 403 });
    expect((await (await client(cookie, testBindings(cfg)).request("/api/early-access")).json<{ status: string; apps: unknown[] }>())).toMatchObject({ status: "unavailable", apps: [] });
  });
  it("caches the group for a minute", async () => {
    const u = await seedOwner("listed");
    const c = client(await login(u), testBindings(cfg));
    await c.request("/api/early-access"); await c.request("/api/early-access");
    expect(calls).toBe(1);
  });
});
