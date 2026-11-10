import type { Context } from "hono";
import type { AppEnv } from "../types";
import { audit } from "../auditchain";
import { createSession, userById, type LoginMethod } from "./sessions";

/** Shared by every sign-in method: create the user/account on first login, then the session, then audit `auth.login.<method>`. */
export async function finishLogin(c: Context<AppEnv>, email: string, method: LoginMethod): Promise<void> {
  await c.env.DB.prepare("INSERT OR IGNORE INTO users (id, email) VALUES (?, ?)").bind(crypto.randomUUID(), email).run();
  // A pending household invite is never applied here: the signed-in user must accept it explicitly (see account/household.ts).
  await c.env.DB.batch([
    // Own account only for someone with no membership at all (a household member keeps just the household).
    c.env.DB.prepare("INSERT OR IGNORE INTO accounts (id, owner) SELECT id, id FROM users WHERE email = ? AND NOT EXISTS (SELECT 1 FROM members WHERE user_id = users.id)").bind(email),
    c.env.DB.prepare("INSERT OR IGNORE INTO members (account_id, user_id, role) SELECT a.id, u.id, 'owner' FROM users u JOIN accounts a ON a.owner = u.id WHERE u.email = ?").bind(email),
  ]);
  const u = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
  const user = u && await userById(c, u.id);
  if (!user) throw new Error("user_creation_failed");
  await createSession(c, user, method);
  await audit(c, `auth.login.${method}`, user.id);
}
