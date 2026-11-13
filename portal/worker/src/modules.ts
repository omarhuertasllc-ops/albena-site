import type { Hono } from "hono";
import type { AppEnv } from "./types";
import * as auth from "./auth";
import * as billing from "./billing";
import * as hubs from "./hubs";
import * as hubsecurity from "./hubsecurity";
import * as connectors from "./connectors";
import * as account from "./account";
import * as support from "./support";
import * as integrity from "./integrity";
import * as earlyaccess from "./earlyaccess";

// Static imports on purpose: a broken module must fail at startup, not be swallowed.
export const modules: ReadonlyArray<{ mount(app: Hono<AppEnv>): void; migrations: string[] }> = [integrity, auth, billing, hubs, hubsecurity, connectors, account, support, earlyaccess]; // integrity first: its R3 hold must run before every handler
