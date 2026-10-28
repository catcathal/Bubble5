// Live chat: website visitors talk to the Bubble5 owner. Visitors poll for replies; the owner answers from the portal.
import { sendEmail, escapeHtml } from "./mail.js";

const enc = new TextEncoder();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_BODY = 1000;

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}
async function sha(text) {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function newToken() {
  return [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function ipHash(request) {
  return (await sha("bubble5:" + (request.headers.get("CF-Connecting-IP") || "unknown"))).slice(0, 24);
}
function clean(v, max) {
  return String(v == null ? "" : v).trim().slice(0, max);
}
function siteUrl(env) {
  return (env.SITE_URL || "https://bubble5.online").replace(/\/$/, "");
}

export function isAdmin(env, user) {
  const list = (env.ADMIN_EMAILS || env.NOTIFY_EMAIL || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return !!user && list.includes(String(user.email).toLowerCase());
}

async function touchAdmin(env) {
  await env.DB.prepare("INSERT INTO live_meta (key, value) VALUES ('admin_seen', datetime('now')) ON CONFLICT(key) DO UPDATE SET value = datetime('now')").run();
}
async function adminOnline(env) {
  const r = await env.DB.prepare("SELECT value FROM live_meta WHERE key = 'admin_seen' AND value > datetime('now','-3 minutes')").first();
  return !!r;
}

async function verifyChat(env, id, token) {
  if (!id || !token) return null;
  return env.DB.prepare("SELECT * FROM live_chats WHERE id = ? AND token_hash = ?").bind(Number(id), await sha(String(token))).first();
}

async function notifyOwner(env, ctx, chat, text) {
  if (!env.NOTIFY_EMAIL || !env.RESEND_API_KEY) return;
  const recent = chat.last_notified && (await env.DB.prepare("SELECT 1 AS ok WHERE ? > datetime('now','-10 minutes')").bind(chat.last_notified).first());
  if (recent) return;
  await env.DB.prepare("UPDATE live_chats SET last_notified = datetime('now') WHERE id = ?").bind(chat.id).run();
  const who = chat.name || chat.email || "A visitor";
  const mail = sendEmail(env, {
    to: env.NOTIFY_EMAIL,
    replyTo: chat.email || undefined,
    subject: `Live chat: ${who} says hi`,
    html: `<p><b>${escapeHtml(who)}</b> wrote on your website:</p><blockquote>${escapeHtml(text).replace(/\n/g, "<br>")}</blockquote><p><a href="${siteUrl(env)}/app.html#/live?c=${chat.id}">Reply in Bubble5 live chat</a></p>`,
  });
  if (ctx && ctx.waitUntil) ctx.waitUntil(mail);
}

/* ---------- public (visitor) endpoints ---------- */

export async function handleLivePublic(request, env, url, cors, ctx) {
  const path = url.pathname;
  if (!path.startsWith("/live/")) return null;
  if (!cors["Access-Control-Allow-Origin"]) return json({ error: "Origin not allowed" }, 403);
  if (!env.DB) return json({ error: "Unavailable" }, 503, cors);
  try {
    if (path === "/live/status" && request.method === "GET") return json({ online: await adminOnline(env) }, 200, cors);

    if (path === "/live/poll" && request.method === "GET") {
      const chat = await verifyChat(env, url.searchParams.get("chat_id"), url.searchParams.get("token"));
      if (!chat) return json({ error: "gone" }, 404, cors);
      const after = Number(url.searchParams.get("after")) || 0;
      await env.DB.prepare("UPDATE live_chats SET visitor_seen = datetime('now') WHERE id = ?").bind(chat.id).run();
      const rows = await env.DB.prepare("SELECT id, sender, body, created_at FROM live_messages WHERE chat_id = ? AND id > ? ORDER BY id LIMIT 100").bind(chat.id, after).all();
      return json({ messages: rows.results || [], online: await adminOnline(env), status: chat.status }, 200, cors);
    }

    if ((path === "/live/start" || path === "/live/send") && request.method === "POST") {
      let b;
      try { b = await request.json(); } catch { return json({ error: "Invalid request." }, 400, cors); }
      if (b && b.website) return json({ ok: true }, 200, cors); // honeypot
      const body = clean(b.message, MAX_BODY);
      if (!body) return json({ error: "Type a message first." }, 400, cors);
      const ip = await ipHash(request);
      const burst = await env.DB.prepare("SELECT COUNT(*) AS n FROM live_messages WHERE ip_hash = ? AND created_at > datetime('now','-1 minute')").bind(ip).first();
      if (burst && burst.n >= 8) return json({ error: "You're sending messages quickly. Please wait a moment." }, 429, cors);

      let chat;
      if (path === "/live/start") {
        const email = clean(b.email, 200);
        const name = clean(b.name, 80);
        if (email && !EMAIL_RE.test(email)) return json({ error: "That email does not look right." }, 400, cors);
        if (!email && !(await adminOnline(env))) return json({ error: "We're away right now. Please add your email so we can reply when we're back." }, 400, cors);
        const fresh = await env.DB.prepare("SELECT COUNT(*) AS n FROM live_chats WHERE ip_hash = ? AND created_at > datetime('now','-1 hour')").bind(ip).first();
        if (fresh && fresh.n >= 5) return json({ error: "Too many chats started. Please try again later." }, 429, cors);
        const token = newToken();
        const res = await env.DB.prepare("INSERT INTO live_chats (visitor, name, email, token_hash, ip_hash, visitor_seen) VALUES (?, ?, ?, ?, ?, datetime('now'))")
          .bind(clean(b.visitor, 40) || "anon", name || null, email || null, await sha(token), ip).run();
        chat = await env.DB.prepare("SELECT * FROM live_chats WHERE id = ?").bind(res.meta.last_row_id).first();
        chat._token = token;
      } else {
        chat = await verifyChat(env, b.chat_id, b.token);
        if (!chat) return json({ error: "gone" }, 404, cors);
      }
      const ins = await env.DB.prepare("INSERT INTO live_messages (chat_id, sender, body, ip_hash) VALUES (?, 'visitor', ?, ?)").bind(chat.id, body, ip).run();
      await env.DB.prepare("UPDATE live_chats SET unread_admin = unread_admin + 1, last_message_at = datetime('now'), status = 'open', visitor_seen = datetime('now') WHERE id = ?").bind(chat.id).run();
      await notifyOwner(env, ctx, chat, body);
      return json({ ok: true, chat_id: chat.id, token: chat._token, message_id: ins.meta.last_row_id, online: await adminOnline(env) }, 200, cors);
    }
  } catch (e) {
    console.error("Live chat error", e);
    return json({ error: "Something went wrong. Please try again." }, 500, cors);
  }
  return json({ error: "Not found" }, 404, cors);
}

/* ---------- owner endpoints (called from app.js with an authenticated admin) ---------- */

export async function adminList(env, cors) {
  await touchAdmin(env);
  const rows = await env.DB.prepare(
    `SELECT c.id, c.name, c.email, c.status, c.unread_admin, c.last_message_at, c.visitor_seen,
       (SELECT body FROM live_messages WHERE chat_id = c.id ORDER BY id DESC LIMIT 1) AS last_body,
       (SELECT sender FROM live_messages WHERE chat_id = c.id ORDER BY id DESC LIMIT 1) AS last_sender,
       (c.visitor_seen > datetime('now','-30 seconds')) AS here
     FROM live_chats c ORDER BY (c.status = 'open') DESC, c.last_message_at DESC LIMIT 60`
  ).all();
  const chats = rows.results || [];
  return json({ chats, unread: chats.reduce((n, c) => n + (c.unread_admin || 0), 0) }, 200, cors);
}

export async function adminThread(env, id, after, cors) {
  await touchAdmin(env);
  const chat = await env.DB.prepare("SELECT id, name, email, status, visitor_seen, (visitor_seen > datetime('now','-30 seconds')) AS here FROM live_chats WHERE id = ?").bind(id).first();
  if (!chat) return json({ error: "Chat not found." }, 404, cors);
  await env.DB.prepare("UPDATE live_chats SET unread_admin = 0 WHERE id = ?").bind(id).run();
  const rows = await env.DB.prepare("SELECT id, sender, body, created_at FROM live_messages WHERE chat_id = ? AND id > ? ORDER BY id LIMIT 200").bind(id, after || 0).all();
  return json({ chat, messages: rows.results || [] }, 200, cors);
}

export async function adminReply(request, env, ctx, id, cors) {
  await touchAdmin(env);
  let b;
  try { b = await request.json(); } catch { return json({ error: "Invalid request." }, 400, cors); }
  const body = clean(b.message, MAX_BODY);
  if (!body) return json({ error: "Type a reply first." }, 400, cors);
  const chat = await env.DB.prepare("SELECT *, (visitor_seen > datetime('now','-2 minutes')) AS here FROM live_chats WHERE id = ?").bind(id).first();
  if (!chat) return json({ error: "Chat not found." }, 404, cors);
  const ins = await env.DB.prepare("INSERT INTO live_messages (chat_id, sender, body) VALUES (?, 'agent', ?)").bind(id, body).run();
  await env.DB.prepare("UPDATE live_chats SET last_message_at = datetime('now'), status = 'open' WHERE id = ?").bind(id).run();
  let emailed = false;
  if (chat.email && !chat.here && env.RESEND_API_KEY) {
    emailed = true;
    const mail = sendEmail(env, {
      to: chat.email,
      replyTo: env.NOTIFY_EMAIL || undefined,
      subject: "Reply from Bubble5",
      html: `<p>Hi${chat.name ? " " + escapeHtml(chat.name) : ""},</p><p>${escapeHtml(body).replace(/\n/g, "<br>")}</p><p style="color:#666">You can reply to this email.</p>`,
    });
    if (ctx && ctx.waitUntil) ctx.waitUntil(mail);
  }
  return json({ ok: true, id: ins.meta.last_row_id, emailed }, 200, cors);
}

export async function adminClose(env, id, cors) {
  const res = await env.DB.prepare("UPDATE live_chats SET status = 'closed', unread_admin = 0 WHERE id = ?").bind(id).run();
  if (!res.meta.changes) return json({ error: "Chat not found." }, 404, cors);
  return json({ ok: true }, 200, cors);
}
