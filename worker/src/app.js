// Business accounts: sign up / log in, knowledge base, billing (Stripe-ready) and health checks.
// Everything here is stored in the D1 database bound as env.DB (see schema.sql).

import { PLANS } from "./plans.js";
import { botGet, botUpdate, botConversations, botLeads, botDeleteData } from "./bot.js";
import { sendEmail } from "./mail.js";
import { isAdmin, adminList, adminThread, adminReply, adminClose } from "./live.js";

const enc = new TextEncoder();
export { PLANS };

const SESSION_DAYS = 30;
const PBKDF2_ITERATIONS = 100000; // the maximum Cloudflare Workers allows
const MAX_DOC_CHARS = 20000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACTIVE_STATUSES = ["active", "trialing", "past_due"];

/* ---------- small helpers ---------- */

function reply(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors },
  });
}

function fail(message, status, cors, extra) {
  return reply({ error: message, ...extra }, status, cors);
}

function toB64Url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64Url(str) {
  const pad = "=".repeat((4 - (str.length % 4)) % 4);
  const bin = atob(str.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function randomToken(bytes = 32) {
  return toB64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function derivePassword(password, salt) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
    key,
    256
  );
  return toB64Url(new Uint8Array(bits));
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function ipKey(request) {
  return (await sha256Hex("bubble5:" + (request.headers.get("CF-Connecting-IP") || "unknown"))).slice(0, 24);
}

async function readJson(request) {
  try {
    const b = await request.json();
    return b && typeof b === "object" ? b : {};
  } catch {
    return null;
  }
}

function clean(value, max) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

export async function turnstileOk(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return true;
  if (!token || typeof token !== "string") return false;
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  return data.success === true;
}

function allowedOrigins(env) {
  return (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
}

function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    company: u.company || "",
    plan: u.plan,
    interval: u.billing_interval || null,
    status: u.sub_status,
    period_end: u.current_period_end || null,
    has_billing: !!u.stripe_customer_id,
    created_at: u.created_at,
  };
}

/* ---------- sessions ---------- */

async function createSession(env, userId) {
  const token = randomToken(32);
  const hash = await sha256Hex(token);
  await env.DB.prepare(
    `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`
  ).bind(userId, hash).run();
  return token;
}

function bearer(request) {
  const h = request.headers.get("Authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

async function currentUser(request, env) {
  const token = bearer(request);
  if (!token) return null;
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT u.*, s.id AS session_id FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > datetime('now')`
  ).bind(hash).first();
  return row || null;
}

/* ---------- account handlers ---------- */

async function signup(request, env, cors) {
  const b = await readJson(request);
  if (!b) return fail("Invalid request.", 400, cors);
  const name = clean(b.name, 100);
  const email = clean(b.email, 200).toLowerCase();
  const company = clean(b.company, 150);
  const password = String(b.password || "");

  if (!name) return fail("Please enter your name.", 400, cors);
  if (!EMAIL_RE.test(email)) return fail("Please enter a valid email address.", 400, cors);
  if (password.length < 8) return fail("Use a password with at least 8 characters.", 400, cors);
  if (password.length > 200) return fail("That password is too long.", 400, cors);

  const ip = await ipKey(request);
  if (!(await turnstileOk(env, b.turnstile, request.headers.get("CF-Connecting-IP")))) {
    return fail("Please complete the captcha and try again.", 400, cors);
  }
  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM login_attempts WHERE key = ? AND kind = 'signup' AND created_at > datetime('now','-1 hour')"
  ).bind(ip).first();
  if (recent && recent.n >= 5) return fail("Too many sign-ups from this network. Please try again later.", 429, cors);

  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  if (existing) return fail("An account with this email already exists. Try logging in instead.", 409, cors);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePassword(password, salt);
  const res = await env.DB.prepare(
    "INSERT INTO users (email, name, company, pw_hash, pw_salt) VALUES (?, ?, ?, ?, ?)"
  ).bind(email, name, company || null, hash, toB64Url(salt)).run();
  const userId = res.meta.last_row_id;
  await env.DB.prepare("INSERT INTO login_attempts (key, kind) VALUES (?, 'signup')").bind(ip).run();

  const token = await createSession(env, userId);
  const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first();
  return reply({ token, user: publicUser(user) }, 201, cors);
}

async function login(request, env, cors) {
  const b = await readJson(request);
  if (!b) return fail("Invalid request.", 400, cors);
  const email = clean(b.email, 200).toLowerCase();
  const password = String(b.password || "");
  if (!EMAIL_RE.test(email) || !password) return fail("Enter your email and password.", 400, cors);

  const ip = await ipKey(request);
  const keys = [email, ip];
  const attempts = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM login_attempts WHERE kind = 'login' AND key IN (?, ?) AND created_at > datetime('now','-15 minutes')"
  ).bind(keys[0], keys[1]).first();
  if (attempts && attempts.n >= 8) {
    return fail("Too many failed attempts. Please wait 15 minutes and try again.", 429, cors);
  }

  const user = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  // Always do the hashing work so a missing account takes as long as a wrong password.
  const salt = user ? fromB64Url(user.pw_salt) : new Uint8Array(16);
  const hash = await derivePassword(password, salt);
  if (!user || !safeEqual(hash, user.pw_hash)) {
    for (const k of keys) await env.DB.prepare("INSERT INTO login_attempts (key, kind) VALUES (?, 'login')").bind(k).run();
    return fail("That email and password don't match.", 401, cors);
  }
  await env.DB.prepare("DELETE FROM login_attempts WHERE kind = 'login' AND key IN (?, ?)").bind(keys[0], keys[1]).run();
  const token = await createSession(env, user.id);
  return reply({ token, user: publicUser(user) }, 200, cors);
}

async function logout(request, env, cors) {
  const token = bearer(request);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
  return reply({ ok: true }, 200, cors);
}

async function overview(env, user, cors) {
  const plan = PLANS[user.plan] || PLANS.none;
  const usage = await env.DB.prepare(
    "SELECT chats FROM usage WHERE user_id = ? AND month = strftime('%Y-%m','now')"
  ).bind(user.id).first();
  const docs = await env.DB.prepare("SELECT COUNT(*) AS n FROM kb_docs WHERE user_id = ?").bind(user.id).first();
  return reply(
    {
      user: publicUser(user),
      usage: { chats: usage ? usage.chats : 0, limit: plan.chats },
      kb: { count: docs ? docs.n : 0, limit: plan.docs, max_chars: MAX_DOC_CHARS },
      billing_ready: !!env.STRIPE_SECRET_KEY,
      email_ready: !!env.RESEND_API_KEY,
      admin: isAdmin(env, user),
    },
    200,
    cors
  );
}

async function updateProfile(request, env, user, cors) {
  const b = await readJson(request);
  if (!b) return fail("Invalid request.", 400, cors);
  const name = clean(b.name, 100);
  const company = clean(b.company, 150);
  if (!name) return fail("Please enter your name.", 400, cors);
  await env.DB.prepare("UPDATE users SET name = ?, company = ? WHERE id = ?").bind(name, company || null, user.id).run();
  const fresh = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(user.id).first();
  return reply({ user: publicUser(fresh) }, 200, cors);
}

async function changePassword(request, env, user, cors) {
  const b = await readJson(request);
  if (!b) return fail("Invalid request.", 400, cors);
  const current = String(b.current_password || "");
  const next = String(b.new_password || "");
  if (next.length < 8) return fail("Use a new password with at least 8 characters.", 400, cors);
  if (next.length > 200) return fail("That password is too long.", 400, cors);
  const hash = await derivePassword(current, fromB64Url(user.pw_salt));
  if (!safeEqual(hash, user.pw_hash)) return fail("Your current password is not correct.", 403, cors);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const newHash = await derivePassword(next, salt);
  await env.DB.prepare("UPDATE users SET pw_hash = ?, pw_salt = ? WHERE id = ?").bind(newHash, toB64Url(salt), user.id).run();
  // Sign out every other device.
  await env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?").bind(user.id, user.session_id).run();
  return reply({ ok: true }, 200, cors);
}

async function deleteAccount(request, env, user, cors) {
  const b = await readJson(request);
  if (!b) return fail("Invalid request.", 400, cors);
  const hash = await derivePassword(String(b.password || ""), fromB64Url(user.pw_salt));
  if (!safeEqual(hash, user.pw_hash)) return fail("Your password is not correct.", 403, cors);
  if (ACTIVE_STATUSES.includes(user.sub_status)) {
    return fail("Cancel your subscription in Billing before deleting your account.", 409, cors);
  }
  const botStmts = await botDeleteData(env, user.id);
  await env.DB.batch([
    ...botStmts,
    env.DB.prepare("DELETE FROM kb_docs WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM usage WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id),
  ]);
  return reply({ ok: true }, 200, cors);
}

/* ---------- knowledge base ---------- */

async function kbList(env, user, cors) {
  const rows = await env.DB.prepare(
    "SELECT id, title, content, updated_at FROM kb_docs WHERE user_id = ? ORDER BY updated_at DESC, id DESC"
  ).bind(user.id).all();
  return reply({ docs: rows.results || [], limit: (PLANS[user.plan] || PLANS.none).docs, max_chars: MAX_DOC_CHARS }, 200, cors);
}

async function kbSave(request, env, user, cors, id) {
  const b = await readJson(request);
  if (!b) return fail("Invalid request.", 400, cors);
  const title = clean(b.title, 120);
  const content = String(b.content == null ? "" : b.content).trim();
  if (!title) return fail("Give the document a title.", 400, cors);
  if (!content) return fail("Add some text for your chatbot to learn from.", 400, cors);
  if (content.length > MAX_DOC_CHARS) {
    return fail(`Keep each document under ${MAX_DOC_CHARS.toLocaleString("en-US")} characters. Split it into two.`, 400, cors);
  }
  if (id) {
    const own = await env.DB.prepare("SELECT id FROM kb_docs WHERE id = ? AND user_id = ?").bind(id, user.id).first();
    if (!own) return fail("Document not found.", 404, cors);
    await env.DB.prepare("UPDATE kb_docs SET title = ?, content = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(title, content, id).run();
    return reply({ ok: true, id }, 200, cors);
  }
  const limit = (PLANS[user.plan] || PLANS.none).docs;
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM kb_docs WHERE user_id = ?").bind(user.id).first();
  if (count && count.n >= limit) {
    return fail(`Your plan allows ${limit} documents. Delete one or upgrade in Billing.`, 403, cors);
  }
  const res = await env.DB.prepare("INSERT INTO kb_docs (user_id, title, content) VALUES (?, ?, ?)")
    .bind(user.id, title, content).run();
  return reply({ ok: true, id: res.meta.last_row_id }, 201, cors);
}

async function kbDelete(env, user, cors, id) {
  const res = await env.DB.prepare("DELETE FROM kb_docs WHERE id = ? AND user_id = ?").bind(id, user.id).run();
  if (!res.meta.changes) return fail("Document not found.", 404, cors);
  return reply({ ok: true }, 200, cors);
}

/* ---------- billing (Stripe) ---------- */

function priceMap(env) {
  try {
    return JSON.parse(env.STRIPE_PRICES || "{}");
  } catch {
    return {};
  }
}

function priceLookup(env, priceId) {
  const map = priceMap(env);
  for (const plan of Object.keys(map)) {
    for (const interval of Object.keys(map[plan] || {})) {
      if (map[plan][interval] === priceId) return { plan, interval };
    }
  }
  return null;
}

async function stripeCall(env, method, path, params) {
  const url = new URL("https://api.stripe.com/v1" + path);
  const init = { method, headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } };
  if (method === "GET") {
    for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  } else {
    init.headers["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = new URLSearchParams(params || {});
  }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("Stripe error", res.status, JSON.stringify(data && data.error));
    throw new Error((data && data.error && data.error.message) || "Stripe request failed");
  }
  return data;
}

function returnBase(env, body) {
  const allowed = allowedOrigins(env);
  try {
    const u = new URL(String(body.return_url || ""));
    if (allowed.includes(u.origin)) return u.origin + u.pathname;
  } catch {
    /* fall through */
  }
  return (allowed[0] || "") + "/";
}

const NOT_READY = "Online payments are still being set up. Contact us and we'll start your plan by hand.";

async function billingInfo(env, user, cors) {
  const plan = PLANS[user.plan] || PLANS.none;
  return reply(
    {
      plan: user.plan,
      plan_name: plan.name,
      interval: user.billing_interval || null,
      status: user.sub_status,
      period_end: user.current_period_end || null,
      has_billing: !!user.stripe_customer_id,
      billing_ready: !!env.STRIPE_SECRET_KEY,
    },
    200,
    cors
  );
}

async function billingCheckout(request, env, user, cors) {
  if (!env.STRIPE_SECRET_KEY) return fail(NOT_READY, 501, cors, { code: "billing_not_ready" });
  const b = await readJson(request);
  if (!b) return fail("Invalid request.", 400, cors);
  const plan = String(b.plan || "");
  const interval = String(b.interval || "");
  const priceId = priceMap(env)[plan] && priceMap(env)[plan][interval];
  if (!priceId) return fail("That plan isn't available for online checkout yet. Contact us and we'll set it up.", 400, cors);
  if (ACTIVE_STATUSES.includes(user.sub_status) && user.stripe_customer_id) {
    return fail("You already have a subscription. Use Manage billing to change plans.", 409, cors);
  }
  const base = returnBase(env, b);
  const params = {
    mode: "subscription",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    success_url: `${base}#/billing?checkout=success`,
    cancel_url: `${base}#/billing?checkout=cancelled`,
    client_reference_id: String(user.id),
    "metadata[plan]": plan,
    "metadata[interval]": interval,
    "subscription_data[metadata][user_id]": String(user.id),
  };
  if (user.stripe_customer_id) params.customer = user.stripe_customer_id;
  else params.customer_email = user.email;
  try {
    const session = await stripeCall(env, "POST", "/checkout/sessions", params);
    return reply({ url: session.url }, 200, cors);
  } catch (e) {
    return fail("We couldn't start checkout. Please try again or contact us.", 502, cors);
  }
}

async function billingPortal(request, env, user, cors) {
  if (!env.STRIPE_SECRET_KEY) return fail(NOT_READY, 501, cors, { code: "billing_not_ready" });
  if (!user.stripe_customer_id) return fail("You don't have a subscription to manage yet.", 400, cors);
  const b = (await readJson(request)) || {};
  try {
    const session = await stripeCall(env, "POST", "/billing_portal/sessions", {
      customer: user.stripe_customer_id,
      return_url: `${returnBase(env, b)}#/billing`,
    });
    return reply({ url: session.url }, 200, cors);
  } catch (e) {
    return fail("We couldn't open the billing portal. Please try again or contact us.", 502, cors);
  }
}

async function billingInvoices(env, user, cors) {
  if (!env.STRIPE_SECRET_KEY || !user.stripe_customer_id) return reply({ invoices: [] }, 200, cors);
  try {
    const data = await stripeCall(env, "GET", "/invoices", { customer: user.stripe_customer_id, limit: "12" });
    const invoices = (data.data || []).map((i) => ({
      id: i.id,
      number: i.number,
      amount: (i.amount_paid != null && i.status === "paid" ? i.amount_paid : i.amount_due) / 100,
      currency: String(i.currency || "usd").toUpperCase(),
      status: i.status,
      date: i.created ? new Date(i.created * 1000).toISOString() : null,
      url: i.hosted_invoice_url || null,
    }));
    return reply({ invoices }, 200, cors);
  } catch (e) {
    return fail("We couldn't load your invoices right now.", 502, cors);
  }
}

async function verifyStripeSignature(env, payload, header) {
  if (!env.STRIPE_WEBHOOK_SECRET || !header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i), p.slice(i + 1)];
    })
  );
  const t = parts.t;
  const v1 = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!t || !v1.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(env.STRIPE_WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${payload}`));
  const expected = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return v1.some((s) => safeEqual(s, expected));
}

function subscriptionFields(env, sub) {
  const item = sub.items && sub.items.data && sub.items.data[0];
  const priceId = item && item.price && item.price.id;
  const found = priceId ? priceLookup(env, priceId) : null;
  const end = sub.current_period_end || (item && item.current_period_end) || null;
  return {
    plan: found ? found.plan : null,
    interval: found ? found.interval : item && item.price && item.price.recurring ? (item.price.recurring.interval === "year" ? "annual" : "monthly") : null,
    status: sub.status,
    period_end: end ? new Date(end * 1000).toISOString() : null,
  };
}

async function stripeWebhook(request, env) {
  const payload = await request.text();
  if (!(await verifyStripeSignature(env, payload, request.headers.get("Stripe-Signature")))) {
    return new Response("Invalid signature", { status: 400 });
  }
  let event;
  try {
    event = JSON.parse(payload);
  } catch {
    return new Response("Bad payload", { status: 400 });
  }
  const obj = event.data && event.data.object;
  if (!obj) return new Response("ok", { status: 200 });

  if (event.type === "checkout.session.completed" && obj.mode === "subscription") {
    const userId = Number(obj.client_reference_id);
    if (userId) {
      const interval = obj.metadata && obj.metadata.interval ? obj.metadata.interval : null;
      const plan = obj.metadata && obj.metadata.plan ? obj.metadata.plan : null;
      await env.DB.prepare(
        "UPDATE users SET stripe_customer_id = ?, stripe_subscription_id = ?, plan = COALESCE(?, plan), billing_interval = COALESCE(?, billing_interval), sub_status = 'active' WHERE id = ?"
      ).bind(obj.customer || null, obj.subscription || null, PLANS[plan] ? plan : null, interval, userId).run();
    }
  } else if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const f = subscriptionFields(env, obj);
    if (event.type === "customer.subscription.deleted") {
      await env.DB.prepare(
        "UPDATE users SET plan = 'none', sub_status = 'canceled', stripe_subscription_id = NULL WHERE stripe_customer_id = ?"
      ).bind(obj.customer).run();
    } else {
      await env.DB.prepare(
        "UPDATE users SET plan = COALESCE(?, plan), billing_interval = COALESCE(?, billing_interval), sub_status = ?, current_period_end = ?, stripe_subscription_id = ? WHERE stripe_customer_id = ?"
      ).bind(f.plan, f.interval, f.status, f.period_end, obj.id, obj.customer).run();
    }
  } else if (event.type === "invoice.payment_failed") {
    await env.DB.prepare("UPDATE users SET sub_status = 'past_due' WHERE stripe_customer_id = ?").bind(obj.customer).run();
  }
  return new Response("ok", { status: 200 });
}

/* ---------- password reset by email ---------- */

async function forgotPassword(request, env, cors, ctx) {
  const b = await readJson(request);
  if (!b) return fail("Invalid request.", 400, cors);
  const email = clean(b.email, 200).toLowerCase();
  const generic = reply({ ok: true, emailed: !!env.RESEND_API_KEY }, 200, cors);
  if (!EMAIL_RE.test(email)) return generic;
  const key = await ipKey(request);
  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM login_attempts WHERE kind = 'reset' AND key = ? AND created_at > datetime('now','-1 hour')"
  ).bind(key).first();
  if (recent && recent.n >= 5) return fail("Too many requests. Please try again later.", 429, cors);
  await env.DB.prepare("INSERT INTO login_attempts (key, kind) VALUES (?, 'reset')").bind(key).run();
  const user = await env.DB.prepare("SELECT id, name FROM users WHERE email = ?").bind(email).first();
  if (!user || !env.RESEND_API_KEY) return generic;
  const token = randomToken(32);
  await env.DB.prepare("INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, datetime('now','+1 hour'))")
    .bind(user.id, "reset:" + (await sha256Hex(token))).run();
  const origin = request.headers.get("Origin");
  const base = (origin && allowedOrigins(env).includes(origin) ? origin : "https://bubble5.online") + "/app.html#/reset?token=" + token;
  const mail = sendEmail(env, {
    to: email,
    subject: "Reset your Bubble5 password",
    html: `<p>Hi ${String(user.name).replace(/[<>&]/g, "")},</p><p>Use this link to choose a new password. It works for one hour.</p><p><a href="${base}">Reset my password</a></p><p>If you did not ask for this, you can ignore this email.</p>`,
  });
  if (ctx && ctx.waitUntil) ctx.waitUntil(mail);
  return generic;
}

async function resetPassword(request, env, cors) {
  const b = await readJson(request);
  if (!b) return fail("Invalid request.", 400, cors);
  const next = String(b.new_password || "");
  if (next.length < 8) return fail("Use a new password with at least 8 characters.", 400, cors);
  if (next.length > 200) return fail("That password is too long.", 400, cors);
  const th = "reset:" + (await sha256Hex(String(b.token || "")));
  const row = await env.DB.prepare("SELECT id, user_id FROM sessions WHERE token_hash = ? AND expires_at > datetime('now')").bind(th).first();
  if (!row) return fail("This reset link has expired. Request a new one.", 400, cors);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePassword(next, salt);
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET pw_hash = ?, pw_salt = ? WHERE id = ?").bind(hash, toB64Url(salt), row.user_id),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(row.user_id),
  ]);
  return reply({ ok: true }, 200, cors);
}

/* ---------- owner tools (ADMIN_TOKEN) ---------- */

async function adminSetPlan(request, env, cors) {
  const supplied = request.headers.get("X-Admin-Token");
  if (!env.ADMIN_TOKEN || !supplied || !safeEqual(supplied, env.ADMIN_TOKEN)) return fail("Unauthorized", 401, cors);
  const b = await readJson(request);
  if (!b || !PLANS[b.plan]) return fail("Send {email, plan} with plan none, starter, pro or enterprise.", 400, cors);
  const res = await env.DB.prepare("UPDATE users SET plan = ?, sub_status = ? WHERE email = ?")
    .bind(b.plan, b.plan === "none" ? "inactive" : "active", clean(b.email, 200).toLowerCase()).run();
  return reply({ ok: true, updated: res.meta.changes }, 200, cors);
}

/* ---------- health ---------- */

async function health(env, cors) {
  const checks = { api: "ok", database: "unknown", ai_search: "unknown" };
  try {
    await env.DB.prepare("SELECT 1 AS ok").first();
    checks.database = "ok";
  } catch {
    checks.database = "error";
  }
  try {
    await env.AI_SEARCH.list({ per_page: 1 });
    checks.ai_search = "ok";
  } catch {
    checks.ai_search = "error";
  }
  const status = Object.values(checks).every((v) => v === "ok") ? "ok" : "degraded";
  return reply(
    {
      status,
      checks,
      features: {
        billing: env.STRIPE_SECRET_KEY ? "on" : "off",
        captcha: env.TURNSTILE_SECRET ? "on" : "off",
        email_alerts: env.RESEND_API_KEY && env.NOTIFY_EMAIL ? "on" : "off",
      },
      time: new Date().toISOString(),
    },
    200,
    cors
  );
}

/* ---------- router ---------- */

export async function handleApp(request, env, url, cors, ctx) {
  const path = url.pathname;
  const method = request.method;

  if (path === "/stripe-webhook" && method === "POST") return stripeWebhook(request, env);
  if (path === "/health" && method === "GET") return health(env, cors);
  if (path === "/admin/plan" && method === "POST" && env.DB) return adminSetPlan(request, env, cors);

  const isAccountRoute =
    path.startsWith("/auth/") || path === "/me" || path.startsWith("/me/") || path.startsWith("/kb") || path.startsWith("/billing") || path.startsWith("/bot") || path.startsWith("/admin/live");
  if (!isAccountRoute) return null;
  if (!env.DB) return fail("The account service is not available.", 503, cors);

  try {
    if (path === "/auth/signup" && method === "POST") return await signup(request, env, cors);
    if (path === "/auth/login" && method === "POST") return await login(request, env, cors);
    if (path === "/auth/logout" && method === "POST") return await logout(request, env, cors);
    if (path === "/auth/forgot" && method === "POST") return await forgotPassword(request, env, cors, ctx);
    if (path === "/auth/reset" && method === "POST") return await resetPassword(request, env, cors);

    const user = await currentUser(request, env);
    if (!user) return fail("Please log in to continue.", 401, cors, { code: "unauthorized" });

    if (path === "/me") {
      if (method === "GET") return await overview(env, user, cors);
      if (method === "PATCH") return await updateProfile(request, env, user, cors);
      if (method === "DELETE") return await deleteAccount(request, env, user, cors);
    }
    if (path === "/me/password" && method === "POST") return await changePassword(request, env, user, cors);

    if (path === "/kb" && method === "GET") return await kbList(env, user, cors);
    if (path === "/kb" && method === "POST") return await kbSave(request, env, user, cors, null);
    const m = path.match(/^\/kb\/(\d+)$/);
    if (m && method === "PUT") return await kbSave(request, env, user, cors, Number(m[1]));
    if (m && method === "DELETE") return await kbDelete(env, user, cors, Number(m[1]));

    if (path.startsWith("/admin/live")) {
      if (!isAdmin(env, user)) return fail("Not allowed.", 403, cors);
      if (path === "/admin/live" && method === "GET") return await adminList(env, cors);
      const lm = path.match(/^\/admin\/live\/(\d+)(\/close)?$/);
      if (lm && !lm[2] && method === "GET") return await adminThread(env, Number(lm[1]), Number(url.searchParams.get("after")) || 0, cors);
      if (lm && !lm[2] && method === "POST") return await adminReply(request, env, ctx, Number(lm[1]), cors);
      if (lm && lm[2] && method === "POST") return await adminClose(env, Number(lm[1]), cors);
    }

    if (path === "/bot" && method === "GET") return await botGet(env, user, cors);
    if (path === "/bot" && method === "PATCH") return await botUpdate(request, env, user, cors);
    if (path === "/bot/conversations" && method === "GET") return await botConversations(env, user, cors);
    if (path === "/bot/leads" && method === "GET") return await botLeads(env, user, cors);

    if (path === "/billing" && method === "GET") return await billingInfo(env, user, cors);
    if (path === "/billing/checkout" && method === "POST") return await billingCheckout(request, env, user, cors);
    if (path === "/billing/portal" && method === "POST") return await billingPortal(request, env, user, cors);
    if (path === "/billing/invoices" && method === "GET") return await billingInvoices(env, user, cors);
  } catch (e) {
    console.error("App route error", path, e);
    return fail("Something went wrong on our side. Please try again.", 500, cors);
  }
  return fail("Not found.", 404, cors);
}
