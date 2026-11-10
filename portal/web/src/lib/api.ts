// Same-origin portal API client (see portal/CONTRACT.md). Session cookie is HttpOnly; no tokens in JS.
import type { HubDetail, ModuleSeries, MetricPoint, MetricRange, Account, BillingSummary, HeldPlan, Hub, Interval, Invoice, Me, Order, PairStart, Passkey, PlanId, Release, Session, SignIn, Connector, Member, ConnectionsView, SecurityOverview } from './types';

export class ApiError extends Error {
  constructor(public status: number, public code: string, public body: unknown = undefined) { super(code); }
}

/** Mock mode: `astro dev` only. `import.meta.env.DEV` is false in prod so this whole branch is dead-code-eliminated. */
export const MOCK: boolean = import.meta.env.DEV && new URLSearchParams(location.search).get('mock') === '1';

type Handler = (method: string, path: string, body: unknown) => unknown;
let mockHandler: Handler | undefined;
async function mock(): Promise<Handler> {
  if (!import.meta.env.DEV) throw new Error('mock disabled');
  return (mockHandler ??= (await import('./mock')).handle);
}

export function goLogin() {
  if (location.pathname !== '/login') location.assign('/login');
}

export async function req<T>(method: string, path: string, body?: unknown, opts: { noRedirect?: boolean } = {}): Promise<T> {
  if (MOCK) {
    await new Promise((r) => setTimeout(r, 90));
    return (await mock())(method, path, body) as T;
  }
  const headers = new Headers({ Accept: 'application/json' });
  if (method !== 'GET') headers.set('X-Requested-With', 'albena-portal');
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  const res = await fetch(path, {
    method, headers, credentials: 'same-origin', cache: 'no-store', redirect: 'manual',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 && !opts.noRedirect) { goLogin(); throw new ApiError(401, 'unauthorized'); }
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, String((data as { error?: string }).error ?? 'error'), data);
  return data as T;
}
const get = <T>(p: string) => req<T>('GET', p);

/** Wire shapes: exactly what the worker returns (portal/CONTRACT.md). Times are unix seconds unless noted. */
namespace W {
  export interface Me { user: { id: string; email: string; role: 'owner' | 'member'; accountId: string }; viewAs?: { actor: string; expiresAt: number } }
  export interface Sessions { sessions: { id: string; createdAt: number; lastSeen: number; expiresAt: number; current: boolean }[] }
  export interface History { events: { at: string; method: 'passkey' | 'magic_link' | 'microsoft' }[] } // at: ISO-8601 from the audit chain
  export interface Passkeys { passkeys: { id: string; createdAt: number }[] }
  export interface Summary {
    entitlement: { plan: HeldPlan | 'none'; status: BillingSummary['status']; active: boolean; maxHubs: number; billingInterval: Interval | null;
      currentPeriodEnd: number | null; cancelAtPeriodEnd: boolean; stripeSubscriptionId: string | null; source: 'stripe' | 'manual'; endsAt: number | null; comp: boolean };
    hasBillingAccount: boolean;
  }
  export interface Invoices { invoices: { id: string; number: string | null; status: Invoice['status']; amountPaid: number; amountDue: number; currency: string; created: number; hostedInvoiceUrl: string | null; pdf: string | null }[] }
  export interface Orders { orders: { id: string; plan: PlanId; shippingStatus: string; refunded: boolean; amountTotal: number | null; currency: string | null; createdAt: number; carrier: string | null; tracking: string | null }[] }
  export interface WireHub {
    id: string; name: string; edition: 'mac' | 'nvidia'; profile: string; version: string; updateChannel: 'stable' | 'beta'; remoteAccess: boolean;
    health: { ok: boolean; services: [string, string][] } | null; lastSeen: number | null; createdAt: number;
    online?: boolean; summary?: Hub['summary'];
  }
  export interface Release { edition: string; channel: string; version: string; manifestUrl: string; signatureUrl: string; signature: string | null; signatureScheme: string; namespace: string; sha256: string; releasedAt: number }
  export interface Account { account: { id: string; createdAt: number }; members: Member[]; invites?: { id: string; email: string; createdAt: number; expiresAt: number }[]; connectors: Connector[] }
}

const iso = (s: number) => new Date(s * 1000).toISOString();
const isoOrNull = (s: number | null) => (s === null ? null : iso(s));
const ONLINE_WINDOW_S = 15 * 60; // hubs heartbeat every few minutes
const PLAN_NAMES: Record<HeldPlan | 'none', string> = { none: 'No plan', byo: 'Bring your own', hub_mac: 'Hub for Mac', hub_nvidia: 'Hub for NVIDIA', estate: 'Estate', pilot: 'Pilot' };
const ORDER_STATUS: Record<string, Order['status']> = { pending_fulfillment: 'processing', pending: 'processing', preparing: 'processing', shipped: 'shipped', delivered: 'delivered', cancelled_refunded: 'canceled', cancelled: 'canceled', awaiting_payment: 'processing', payment_failed: 'canceled' };
const hub = (h: W.WireHub): Hub => ({
  id: h.id, name: h.name, edition: h.edition, version: h.version, profile: h.profile, updateChannel: h.updateChannel, remoteAccess: h.remoteAccess,
  lastSeenAt: isoOrNull(h.lastSeen), online: h.online ?? (h.lastSeen !== null && Date.now() / 1000 - h.lastSeen < ONLINE_WINDOW_S), summary: h.summary ?? null,
  health: h.health === null ? null : h.health.ok ? 'ok' : 'degraded',
});

export const api = {
  me: async (): Promise<Me> => { const r = await get<W.Me>('/api/me'); return r.viewAs ? { ...r.user, viewAs: r.viewAs } : r.user; },
  endViewAs: () => req<{ redirect: string }>('POST', '/api/support/view-as/end', {}, { noRedirect: true }),
  supportAccounts: () => req<{ me: string; accounts: { id: string; email: string; plan: string; status: string; hubs: number; created: number }[] }>('GET', '/api/support/accounts', undefined, { noRedirect: true }),
  logout: () => req<unknown>('POST', '/api/auth/logout', {}),
  magicStart: (email: string, turnstileToken: string) => req<unknown>('POST', '/api/auth/magic/start', { email, turnstileToken }, { noRedirect: true }),
  providers: () => req<{ microsoft: boolean }>('GET', '/api/auth/providers', undefined, { noRedirect: true }),
  magicCode: (code: string) => req<unknown>('POST', '/api/auth/magic/code', { code }, { noRedirect: true }),
  // Options come back as the bare WebAuthn options; the server keeps the challenge. Verify takes the raw browser response.
  passkeyLoginOptions: () => req<Record<string, unknown>>('POST', '/api/auth/passkey/login/options', {}, { noRedirect: true }),
  passkeyLoginVerify: (response: unknown) => req<unknown>('POST', '/api/auth/passkey/login/verify', response, { noRedirect: true }),
  passkeyRegisterOptions: () => req<Record<string, unknown>>('POST', '/api/auth/passkey/register/options', {}),
  passkeyRegisterVerify: (response: unknown) => req<unknown>('POST', '/api/auth/passkey/register/verify', response),
  passkeys: async (): Promise<Passkey[]> => (await get<W.Passkeys>('/api/security/passkeys')).passkeys.map((k) => ({ id: k.id, createdAt: iso(k.createdAt) })),
  passkeyRemove: (id: string) => req<unknown>('DELETE', `/api/security/passkeys/${encodeURIComponent(id)}`),
  sessions: async (): Promise<Session[]> => (await get<W.Sessions>('/api/security/sessions')).sessions.map((s) => ({ id: s.id, current: s.current, createdAt: iso(s.createdAt), lastSeenAt: iso(s.lastSeen) })),
  revokeSession: (id: string) => req<unknown>('DELETE', `/api/security/sessions/${encodeURIComponent(id)}`),
  securityOverview: () => get<SecurityOverview>('/api/security/overview'),
  chainAck: (hubId: string, sig: string, note?: string) => req<unknown>('POST', `/api/hubs/${encodeURIComponent(hubId)}/security/chain-ack`, note ? { sig, note } : { sig }),
  revokeTrust: (hubId: string) => req<unknown>('POST', `/api/hubs/${encodeURIComponent(hubId)}/security/revoke-trust`, {}),
  history: async (): Promise<SignIn[]> => (await get<W.History>('/api/security/history')).events,
  billing: async (): Promise<BillingSummary> => {
    const { entitlement: e } = await get<W.Summary>('/api/billing/summary');
    return { plan: e.plan, planName: PLAN_NAMES[e.plan] + (e.comp ? ' (complimentary)' : ''), status: e.status, interval: e.billingInterval, renewsAt: isoOrNull(e.currentPeriodEnd), cancelAtPeriodEnd: e.cancelAtPeriodEnd, maxHubs: e.maxHubs, source: e.source ?? 'stripe', endsAt: isoOrNull(e.endsAt ?? null), comp: !!e.comp };
  },
  invoices: async (): Promise<Invoice[]> => (await get<W.Invoices>('/api/billing/invoices')).invoices.map((i) => ({
    id: i.id, number: i.number ?? i.id, date: iso(i.created), amount: i.status === 'paid' ? i.amountPaid : i.amountDue, currency: i.currency, status: i.status, url: i.hostedInvoiceUrl,
  })),
  checkout: (plan: PlanId, interval: Interval) => req<{ url: string }>('POST', '/api/billing/checkout', { plan, interval }),
  portal: () => req<{ url: string }>('POST', '/api/billing/portal', {}),
  orders: async (): Promise<Order[]> => (await get<W.Orders>('/api/billing/orders')).orders.map((o) => ({
    id: o.id, item: `Albena Hub (${o.plan === 'hub_nvidia' ? 'NVIDIA' : 'Mac'})`, placedAt: iso(o.createdAt),
    status: o.refunded ? 'canceled' : (ORDER_STATUS[o.shippingStatus] ?? 'processing'), total: o.amountTotal, currency: o.currency, carrier: o.carrier ?? null, tracking: o.tracking ?? null,
  })),
  hubs: async (): Promise<Hub[]> => (await get<{ hubs: W.WireHub[] }>('/api/hubs')).hubs.map(hub),
  pairStart: async (): Promise<PairStart> => { const r = await req<{ code: string; expiresAt: number }>('POST', '/api/hubs/pair/start', {}); return { code: r.code, expiresAt: iso(r.expiresAt) }; },
  hubDetail: async (id: string): Promise<HubDetail> => (await get<{ hub: HubDetail }>(`/api/hubs/${encodeURIComponent(id)}`)).hub,
  hubMetrics: async (id: string, range: MetricRange): Promise<MetricPoint[]> => (await get<{ points: MetricPoint[] }>(`/api/hubs/${encodeURIComponent(id)}/metrics?range=${range}`)).points,
  hubModules: async (id: string, range: MetricRange): Promise<ModuleSeries[]> => (await get<{ modules: ModuleSeries[] }>(`/api/hubs/${encodeURIComponent(id)}/modules?range=${range}`)).modules,
  hubPatch: async (id: string, patch: Partial<Pick<Hub, 'name' | 'updateChannel' | 'remoteAccess'>>): Promise<Hub> => hub((await req<{ hub: W.WireHub }>('PATCH', `/api/hubs/${encodeURIComponent(id)}`, patch)).hub),
  hubDelete: (id: string) => req<unknown>('DELETE', `/api/hubs/${encodeURIComponent(id)}`),
  release: async (edition: string): Promise<Release> => {
    const r = await get<W.Release>(`/api/releases/latest?edition=${encodeURIComponent(edition)}`);
    return { edition: r.edition, version: r.version, releasedAt: iso(r.releasedAt), manifestUrl: r.manifestUrl, signatureUrl: r.signatureUrl, sha256: r.sha256 };
  },
  account: async (): Promise<Account> => { const r = await get<W.Account>('/api/account'); return { id: r.account.id, members: r.members, invites: (r.invites ?? []).map((i) => ({ id: i.id, email: i.email, expiresAt: iso(i.expiresAt) })), connectors: r.connectors }; },
  connectors: () => get<ConnectionsView>('/api/connectors'),
  /** Household invitations addressed to the signed-in user; joining happens only through acceptInvitation. */
  invitations: async () => (await get<{ invitations: { id: string; inviterEmail: string; expiresAt: number }[] }>('/api/account/invitations')).invitations,
  acceptInvitation: (id: string) => req<unknown>('POST', `/api/account/invitations/${encodeURIComponent(id)}/accept`, {}),
  declineInvitation: (id: string) => req<unknown>('POST', `/api/account/invitations/${encodeURIComponent(id)}/decline`, {}),
  inviteMember: (email: string) => req<unknown>('POST', '/api/account/members/invite', { email }),
  revokeMemberInvite: (id: string) => req<unknown>('DELETE', `/api/account/members/invites/${encodeURIComponent(id)}`),
  removeMember: (id: string) => req<unknown>('DELETE', `/api/account/members/${encodeURIComponent(id)}`),
  inviteAccept: (token: string, email: string, turnstileToken: string) => req<unknown>('POST', '/api/invite/accept', { token, email, turnstileToken }, { noRedirect: true }),
  exportData: () => get<unknown>('/api/account/export'),
  deleteAccount: (confirm: string, cancelBilling = false) => req<unknown>('POST', '/api/account/delete', cancelBilling ? { confirm, cancelBilling: true } : { confirm }),
};

export function errMsg(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 429) return 'Too many attempts. Wait a minute and try again.';
    if (e.code === 'passkey_required') return 'Sign in with a passkey to do this. An email-link session cannot.';
    if (e.code === 'sig_mismatch' || e.code === 'no_break' || e.code === 'already_acked') return 'That break is no longer current. Refresh to see the latest state.';
    if (e.status >= 500) return 'The service had a problem. Try again shortly.';
    return e.code === 'error' ? 'Something went wrong.' : e.code.replace(/_/g, ' ');
  }
  return 'Network problem. Check your connection and try again.';
}
