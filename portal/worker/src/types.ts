export interface User { id: string; email: string; role: "owner" | "member"; accountId: string }
export interface Bindings {
  DB: D1Database;
  ASSETS: Fetcher;
  PORTAL_SECRETS: string;
  TURNSTILE_SECRET_KEY: string;
  AUTH_IP_LIMITER: RateLimit;
  AUTH_EMAIL_LIMITER: RateLimit;
  ENVIRONMENT: "production" | "development" | "test";
  PORTAL_ORIGIN: string;
  RP_ID: string;
  MAIL_FROM: string;
  MAIL_PROVIDER: "cloudflare" | "dev";
  EMAIL?: SendEmail;
  // Support view-as (Cloudflare Access). TEAM_DOMAIN e.g. purple-firefly-9815.cloudflareaccess.com; ADMIN_AUD is the Access app AUD tag.
  TEAM_DOMAIN?: string; ADMIN_AUD?: string;
  // Comma-separated staff emails allowed to use /support (deny by default when empty).
  SUPPORT_ADMIN_EMAILS?: string;
  // Billing (Stripe test mode until launch). Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET.
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  // Stripe Price IDs (vars). Empty = plan not configured (checkout answers 503).
  PRICE_BYO_MONTHLY?: string; PRICE_BYO_ANNUAL?: string;
  PRICE_HUB_MAC_MONTHLY?: string; PRICE_HUB_MAC_ANNUAL?: string; PRICE_HUB_MAC_HARDWARE?: string;
  // ALB-SEC-1 chain-break alerts to Obvera Event Management (key: secret, scope events.ingest only).
  OBVERA_EVENTS_URL?: string; OBVERA_EVENTS_KEY?: string;
  // Sign in with Microsoft (Entra ID, single tenant). ENTRA_CLIENT_SECRET is a Worker secret; the others are vars. Unset/empty = SSO off.
  ENTRA_CLIENT_ID?: string; ENTRA_TENANT_ID?: string; ENTRA_CLIENT_SECRET?: string;
  PRICE_HUB_NVIDIA_MONTHLY?: string; PRICE_HUB_NVIDIA_ANNUAL?: string; PRICE_HUB_NVIDIA_HARDWARE?: string;
}
export type AppEnv = {
  Bindings: Bindings;
  Variables: { user: User; requestId: string; sessionId: string; loginMethod?: "passkey" | "magic" | "microsoft"; viewAs?: { actor: string; expiresAt: number }; supportActor?: string };
};
