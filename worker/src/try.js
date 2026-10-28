// "Try it" sandbox (paste your business info and chat with it, no sign-up) and the Bubble5 website assistant.
import { generateAnswer } from "./bot.js";
import { SUPPORT_DOCS } from "./supportkb.js";

const pub = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400" };
const MAX_TEXT = 12000;
const MIN_TEXT = 40;
const MAX_CHATS_PER_SESSION = 25;
const SESSIONS_PER_IP_DAY = 12;
const SESSIONS_PER_DAY_TOTAL = 400;
const TONES = ["friendly", "professional", "playful"];

function json(body, status) {
  return new Response(JSON.stringify(body), { status: status || 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...pub } });
}
async function sha(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}
const ipKey = async (request) => sha("bubble5:" + (request.headers.get("CF-Connecting-IP") || "unknown"));
const clean = (v, n) => String(v == null ? "" : v).trim().slice(0, n);

async function rateOk(env, key, max, seconds) {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM rate_hits WHERE key = ? AND created_at > datetime('now', ?)").bind(key, `-${seconds} seconds`).first();
  if (r && r.n >= max) return false;
  await env.DB.prepare("INSERT INTO rate_hits (key) VALUES (?)").bind(key).run();
  return true;
}

function cleanMessages(raw) {
  const msgs = (Array.isArray(raw) ? raw : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.slice(0, 600) }))
    .slice(-8);
  return msgs.length && msgs[msgs.length - 1].role === "user" ? msgs : null;
}

const FALLBACK_SUGGESTIONS = ["What are your opening hours?", "How much does it cost?", "Where are you located?"];

async function makeSuggestions(env, business, text) {
  try {
    const out = await env.AI.run(env.AI_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
      messages: [
        { role: "system", content: "You write example customer questions. Reply with ONLY a JSON array of 4 short questions (max 8 words each) that a customer of this business might ask and that the text below clearly answers. No other text." },
        { role: "user", content: `Business: ${business || "a small business"}\\n\\nText:\\n${text.slice(0, 3000)}` },
      ],
      max_tokens: 160,
      temperature: 0.5,
    });
    const raw = String((out && (out.response || "")) || "");
    const arr = JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1));
    const list = arr.filter((q) => typeof q === "string" && q.trim().length > 3).map((q) => q.trim().slice(0, 80)).slice(0, 4);
    if (list.length >= 2) return list;
  } catch (e) { /* fall through */ }
  return FALLBACK_SUGGESTIONS;
}

export async function handleTry(request, env, url) {
  const path = url.pathname;
  const isTry = path === "/try/start" || /^\/try\/[^/]+\/chat$/.test(path);
  const isSupport = path === "/support/chat";
  if (!isTry && !isSupport) return null;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: pub });
  if (!env.DB || !env.AI) return json({ error: "Unavailable." }, 503);
  try {
    if (isSupport && request.method === "POST") return await supportChat(request, env);
    if (path === "/try/start" && request.method === "POST") return await tryStart(request, env);
    const m = path.match(/^\/try\/([^/]+)\/chat$/);
    if (m && request.method === "POST") return await tryChat(request, env, m[1]);
  } catch (e) {
    console.error("Try error", e);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
  return json({ error: "Not found." }, 404);
}

async function tryStart(request, env) {
  let b;
  try { b = await request.json(); } catch { return json({ error: "Invalid request." }, 400); }
  const text = clean(b.text, MAX_TEXT);
  const business = clean(b.business, 80);
  if (text.length < MIN_TEXT) return json({ error: "Add a bit more information about your business (at least a few lines)." }, 400);
  const ip = await ipKey(request);
  await env.DB.prepare("DELETE FROM try_sessions WHERE created_at < datetime('now','-1 day')").run();
  await env.DB.prepare("DELETE FROM rate_hits WHERE created_at < datetime('now','-1 day')").run();
  const mine = await env.DB.prepare("SELECT COUNT(*) AS n FROM try_sessions WHERE ip_hash = ? AND created_at > datetime('now','-1 day')").bind(ip).first();
  if (mine && mine.n >= SESSIONS_PER_IP_DAY) return json({ error: "You've tried this a few times today. Create a free account to keep going." }, 429);
  const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM try_sessions WHERE created_at > datetime('now','-1 day')").first();
  if (total && total.n >= SESSIONS_PER_DAY_TOTAL) return json({ error: "The demo is very busy today. Please try again tomorrow or create a free account." }, 429);
  const key = "tr_" + [...crypto.getRandomValues(new Uint8Array(10))].map((x) => x.toString(16).padStart(2, "0")).join("");
  const tone = TONES.includes(b.tone) ? b.tone : "friendly";
  await env.DB.prepare("INSERT INTO try_sessions (key, business, tone, text, ip_hash) VALUES (?, ?, ?, ?, ?)").bind(key, business || null, tone, text, ip).run();
  const suggestions = await makeSuggestions(env, business, text);
  return json({ key, suggestions, greeting: business ? `Hi! Welcome to ${business}. What can I help you with?` : "Hi! What can I help you with?" });
}

async function tryChat(request, env, key) {
  let b;
  try { b = await request.json(); } catch { return json({ error: "Invalid request." }, 400); }
  const msgs = cleanMessages(b.messages);
  if (!msgs) return json({ error: "Send a message." }, 400);
  const s = await env.DB.prepare("SELECT * FROM try_sessions WHERE key = ?").bind(key).first();
  if (!s) return json({ error: "expired", message: "This demo has expired. Start a new one." }, 404);
  if (s.msgs >= MAX_CHATS_PER_SESSION) return json({ error: "limit", message: "That's the end of the free demo. Create a free account to keep chatting." }, 402);
  if (!(await rateOk(env, "try:" + (await ipKey(request)), 12, 60))) return json({ error: "slow_down", message: "Give it a moment, then ask again." }, 429);
  const bot = { name: "Assistant", business: s.business, tone: s.tone };
  let r;
  try { r = await generateAnswer(env, { bot, docs: [{ title: s.business || "Your information", content: s.text }], msgs }); }
  catch (e) { console.error("Try AI failed", e); return json({ error: "unavailable", message: "Sorry, I could not answer just now. Try again in a moment." }, 502); }
  await env.DB.prepare("UPDATE try_sessions SET msgs = msgs + 1 WHERE key = ?").bind(key).run();
  if (r.unanswered) {
    return json({
      answer: "I don't have that in the information you gave me, so I won't guess. In a real setup, I'd offer to take the visitor's email and pass the question to you, and it would show up in your Inbox.",
      unanswered: true,
      source: null,
      left: MAX_CHATS_PER_SESSION - s.msgs - 1,
    });
  }
  return json({ answer: r.answer, unanswered: false, source: r.source, left: MAX_CHATS_PER_SESSION - s.msgs - 1 });
}

async function supportChat(request, env) {
  let b;
  try { b = await request.json(); } catch { return json({ error: "Invalid request." }, 400); }
  const msgs = cleanMessages(b.messages);
  if (!msgs) return json({ error: "Send a message." }, 400);
  if (!(await rateOk(env, "support:" + (await ipKey(request)), 15, 60))) return json({ error: "slow_down", message: "Give it a moment, then ask again." }, 429);
  const bot = { name: "Bubble5 Assistant", business: "Bubble5", tone: "friendly" };
  let r;
  try { r = await generateAnswer(env, { bot, docs: SUPPORT_DOCS, msgs }); }
  catch (e) { console.error("Support AI failed", e); return json({ error: "unavailable", message: "Sorry, I can't answer right now. You can talk to a person instead." , handoff: true }, 502); }
  if (r.unanswered) return json({ answer: "That's one for a real person. I can connect you with the team.", handoff: true });
  return json({ answer: r.answer, handoff: false });
}
