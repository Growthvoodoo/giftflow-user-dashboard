/**
 * GiftFlow Dashboard — the staff print station.
 *
 * Warehouse staff log in here, see the gift orders waiting, preview each card
 * and print one or a whole day's batch, without access to the Shopify admin.
 *
 * The browser never sees the GiftFlow API key. Every /api call is made by this
 * server, which adds the key and forwards the request to GiftFlow's staff API.
 */
import "dotenv/config";
import express from "express";
import cookieSession from "cookie-session";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadUsers, verify } from "./lib/users.js";
import { loginPage } from "./lib/login-page.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4000);
const GIFTFLOW_URL = (process.env.GIFTFLOW_URL || "").replace(/\/$/, "");
const API_KEY = process.env.GIFTFLOW_API_KEY || "";
const REFRESH_SECONDS = Math.max(15, Number(process.env.REFRESH_SECONDS || 60));

let SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  SESSION_SECRET = randomBytes(32).toString("hex");
  console.warn("[dashboard] SESSION_SECRET is not set — using a random one; everyone is logged out on restart.");
}
if (!GIFTFLOW_URL || !API_KEY) {
  console.warn("[dashboard] GIFTFLOW_URL and GIFTFLOW_API_KEY must be set in .env — see .env.example.");
}
if (!loadUsers().length) {
  console.warn("[dashboard] No users yet. Add one with: npm run user:add -- <username> (or set DASHBOARD_USERS)");
}

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "same-origin",
  });
  next();
});

app.use(
  cookieSession({
    name: "gfd",
    secret: SESSION_SECRET,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.SECURE_COOKIES === "true",
    maxAge: 12 * 60 * 60 * 1000, // one working day
  }),
);
app.use(express.urlencoded({ extended: false, limit: "10kb" }));
app.use(express.json({ limit: "200kb" }));

// ── login ────────────────────────────────────────────────────────────────────

/** Five wrong passwords per IP per 15 minutes, then a pause. */
const attempts = new Map();
function throttled(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < 15 * 60_000);
  attempts.set(ip, list);
  return list.length >= 5;
}

app.get("/login", (req, res) => {
  if (req.session.user) return res.redirect("/");
  res.type("html").send(loginPage());
});

app.post("/login", async (req, res) => {
  const ip = req.ip;
  if (throttled(ip)) {
    return res.status(429).type("html").send(loginPage("Too many attempts. Wait a few minutes and try again."));
  }
  const user = await verify(req.body.username, req.body.password);
  if (!user) {
    attempts.get(ip).push(Date.now());
    return res.status(401).type("html").send(loginPage("Wrong username or password.", req.body.username));
  }
  attempts.delete(ip);
  req.session.user = user;
  res.redirect("/");
});

app.post("/logout", (req, res) => {
  req.session = null;
  res.redirect("/login");
});

// ── everything below needs a logged-in user ─────────────────────────────────

function requireUser(req, res, next) {
  if (req.session.user) return next();
  if (req.path.startsWith("/api/")) return res.status(401).json({ error: "Your session has ended. Log in again." });
  res.redirect("/login");
}

/**
 * Cross-site request protection for state-changing calls: the page's own
 * fetches send this header, which a form on another site cannot.
 */
function requireAjax(req, res, next) {
  if (req.get("x-requested-with") === "giftflow-dashboard") return next();
  res.status(403).json({ error: "Forbidden" });
}

// The login page needs its stylesheet and icon before anyone is logged in.
app.get(["/styles.css", "/favicon.svg"], express.static(join(ROOT, "public"), { maxAge: "1h" }));

app.use(requireUser);

app.get("/api/config", (req, res) => {
  res.json({ user: req.session.user, refreshSeconds: REFRESH_SECONDS, configured: Boolean(GIFTFLOW_URL && API_KEY) });
});

/** Forwards to GiftFlow's staff API with the key added. */
async function forward(path, { method = "GET", body, query } = {}) {
  if (!GIFTFLOW_URL || !API_KEY) {
    return { status: 503, json: { error: "The dashboard is not connected: set GIFTFLOW_URL and GIFTFLOW_API_KEY in .env." } };
  }
  const url = new URL(`${GIFTFLOW_URL}/api/staff${path}`);
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));

  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(path === "/print" ? 170_000 : 20_000),
    });
  } catch (e) {
    const timeout = e?.name === "TimeoutError";
    return {
      status: 502,
      json: { error: timeout ? "GiftFlow took too long to answer." : `Can't reach GiftFlow at ${GIFTFLOW_URL}.` },
    };
  }
  return { status: res.status, res };
}

async function relayJson(r, res) {
  if (!r.res) return res.status(r.status).json(r.json);
  const data = await r.res.json().catch(() => ({ error: `GiftFlow answered ${r.status}` }));
  if (r.status === 401) data.error = "GiftFlow rejected the API key. Create a new one in GiftFlow → Settings and update .env.";
  res.status(r.status).json(data);
}

app.get("/api/me", async (req, res) => relayJson(await forward("/me"), res));

app.get("/api/orders", async (req, res) => {
  const { view, q, take, skip } = req.query;
  relayJson(await forward("/orders", { query: { view, q, take, skip } }), res);
});

app.get("/api/orders/:id", async (req, res) => {
  relayJson(await forward(`/orders/${encodeURIComponent(req.params.id)}`), res);
});

app.post("/api/status", requireAjax, async (req, res) => {
  relayJson(await forward("/status", { method: "POST", body: { ids: req.body.ids, status: req.body.status } }), res);
});

app.post("/api/moderate", requireAjax, async (req, res) => {
  relayJson(await forward("/moderate", { method: "POST", body: { ids: req.body.ids, decision: req.body.decision } }), res);
});

/** The PDF itself, streamed straight through. */
app.post("/api/print", requireAjax, async (req, res) => {
  const r = await forward("/print", {
    method: "POST",
    body: { ids: req.body.ids, markPrinted: req.body.markPrinted === true },
  });
  if (!r.res || !r.res.ok) return relayJson(r, res);

  res.set({
    "Content-Type": "application/pdf",
    "Content-Disposition": r.res.headers.get("content-disposition") || 'inline; filename="giftflow-cards.pdf"',
    "Cache-Control": "no-store",
  });
  const count = r.res.headers.get("x-card-count");
  if (count) res.set("X-Card-Count", count);
  res.send(Buffer.from(await r.res.arrayBuffer()));
  console.log(`[dashboard] ${req.session.user.username} printed ${count ?? "?"} card(s)`);
});

app.use(express.static(join(ROOT, "public"), { index: "index.html", maxAge: "1h" }));

// On Vercel the platform runs the exported app; everywhere else, listen.
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`[dashboard] GiftFlow Dashboard on http://localhost:${PORT}`);
    console.log(`[dashboard] connected to ${GIFTFLOW_URL || "(GIFTFLOW_URL not set)"}`);
  });
}

export default app;
