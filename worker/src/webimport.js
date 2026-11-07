// Import a public web page into the knowledge base: fetch it, keep the readable text.
// Dependency-free so it can be unit tested in plain Node as well as inside the Worker.

const MAX_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 12000;
const ALLOWED_TYPES = /^(text\/html|application\/xhtml\+xml|text\/plain)/i;

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "-", mdash: "-", hellip: "...", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', copy: "(c)", euro: "EUR", pound: "GBP" };

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(Number(n)); } catch { return " "; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return " "; } })
    .replace(/&([a-z]+);/gi, (m, n) => (ENTITIES[n.toLowerCase()] !== undefined ? ENTITIES[n.toLowerCase()] : m));
}

// Returns { title, text } for an HTML string (or plain text passed through).
export function htmlToText(html) {
  let s = String(html || "");
  const titleMatch = s.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1]).replace(/\s+/g, " ").trim() : "";
  if (!/<\/?[a-z][\s\S]*>/i.test(s)) return { title, text: s.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim() };
  s = s
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|head|nav|footer|form|select|button)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(h[1-6])\b[^>]*>/gi, "\n\n# ")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|section|article|header|main|ul|ol|table|tr|h[1-6]|blockquote|figure|dl|dd)>/gi, "\n\n")
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/(td|th)>/gi, " | ")
    .replace(/<[^>]+>/g, " ");
  const text = decodeEntities(s)
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title, text };
}

const PRIVATE_HOST = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.lan|.*\.home|.*\.corp)$/i;

// Only plain public http(s) addresses on the default ports. Returns { ok, url, error }.
export function checkImportUrl(raw) {
  let u;
  try { u = new URL(String(raw || "").trim()); } catch { return { ok: false, error: "That does not look like a web address. Start it with https://" }; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, error: "Only http and https addresses can be imported." };
  if (u.username || u.password) return { ok: false, error: "Remove the username and password from the address." };
  if (u.port && u.port !== "80" && u.port !== "443") return { ok: false, error: "Only standard web ports can be imported." };
  const h = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!h.includes(".") || PRIVATE_HOST.test(h) || /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(":") || /^\d+$/.test(h.split(".").pop())) {
    return { ok: false, error: "Use the page's normal web address (a domain name), not an IP address or local address." };
  }
  u.hash = "";
  return { ok: true, url: u.toString() };
}

async function readLimited(res) {
  if (!res.body || !res.body.getReader) return (await res.text()).slice(0, MAX_BYTES);
  const reader = res.body.getReader();
  const parts = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) { try { await reader.cancel(); } catch { /* ignore */ } throw new Error("That page is too large to import (over 3 MB)."); }
    parts.push(value);
  }
  const all = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { all.set(p, o); o += p.byteLength; }
  return new TextDecoder("utf-8", { fatal: false }).decode(all);
}

// Fetches the page, following up to 3 redirects (each one re-checked). Throws Error with a customer-friendly message.
export async function fetchPage(rawUrl, fetchImpl) {
  const f = fetchImpl || fetch;
  let current = checkImportUrl(rawUrl);
  if (!current.ok) throw new Error(current.error);
  let url = current.url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await f(url, { redirect: "manual", signal: ctl.signal, headers: { "User-Agent": "Bubble5Bot/1.0 (+https://bubble5.online)", Accept: "text/html,text/plain;q=0.9,*/*;q=0.1" } });
    } catch {
      throw new Error("We could not reach that page. Check the address and that it is public.");
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      const next = checkImportUrl(new URL(res.headers.get("location"), url).toString());
      if (!next.ok) throw new Error("That page redirects somewhere we cannot import.");
      url = next.url;
      continue;
    }
    if (res.status === 401 || res.status === 403) throw new Error("That page is private or blocks automated access. Copy and paste its text instead.");
    if (res.status === 404 || res.status === 410) throw new Error("That page was not found (404).");
    if (!res.ok) throw new Error(`That page returned an error (${res.status}).`);
    const type = res.headers.get("content-type") || "";
    if (!ALLOWED_TYPES.test(type)) throw new Error("Only web pages and text can be imported here. For a PDF, upload the file in the knowledge base.");
    const body = await readLimited(res);
    const { title, text } = htmlToText(body);
    if (text.length < 40) throw new Error("We found almost no text on that page. It may load its content with JavaScript. Copy and paste the text instead.");
    return { url, title: title || new URL(url).hostname, text };
  }
  throw new Error("That page redirects too many times.");
}
