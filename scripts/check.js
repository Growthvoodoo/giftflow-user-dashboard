#!/usr/bin/env node
/** npm run check — confirms .env is filled in and GiftFlow accepts the key. */
import "dotenv/config";
import { loadUsers } from "../lib/users.js";

const url = (process.env.GIFTFLOW_URL || "").replace(/\/$/, "");
const key = process.env.GIFTFLOW_API_KEY || "";
let ok = true;
const say = (good, msg) => { console.log(`${good ? "✓" : "✗"} ${msg}`); if (!good) ok = false; };

say(Boolean(url), url ? `GIFTFLOW_URL = ${url}` : "GIFTFLOW_URL is not set");
say(key.startsWith("gfs_"), key ? "GIFTFLOW_API_KEY is set" : "GIFTFLOW_API_KEY is not set");
say(Boolean(process.env.SESSION_SECRET), process.env.SESSION_SECRET ? "SESSION_SECRET is set" : "SESSION_SECRET is not set (logins reset on every restart)");
const users = loadUsers();
say(users.length > 0, users.length ? `${users.length} user(s)` : "No users — add one with: npm run user:add -- <username>");

if (url && key) {
  try {
    const res = await fetch(`${url}/api/staff/me`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10000) });
    const data = await res.json().catch(() => ({}));
    if (res.ok) say(true, `Connected to ${data.shop.domain} (${data.plan.label} plan, ${data.counts.new} card(s) to print)`);
    else say(false, `GiftFlow answered ${res.status}: ${data.error || "unknown error"}`);
  } catch (e) {
    say(false, `Can't reach ${url}: ${e.message}`);
  }
}
process.exit(ok ? 0 : 1);
