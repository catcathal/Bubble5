// Run with: node --test worker/test
import test from "node:test";
import assert from "node:assert/strict";
import { PLANS, planOf, limitsOf } from "../src/plans.js";
import { sanitizeSettings, effectiveSettings, parseSettings, faqDoc, styleRules, handoffLines, DEFAULTS, TONES } from "../src/botsettings.js";
import { kbCheck } from "../src/app.js";
import { buildSystem, knowledgeChunks, KB_CACHE } from "../src/bot.js";
import { checkImportUrl, htmlToText, fetchPage } from "../src/webimport.js";
import { chunkDocs, rank } from "../src/retrieve.js";

const user = (plan) => ({ plan });

test("paying plans always get more room than the trial, step by step", () => {
  const order = ["none", "starter", "pro", "enterprise"].map((p) => PLANS[p]);
  for (const k of ["docs", "docChars", "totalChars", "urlImports", "instructionChars", "starters", "faqs"]) {
    for (let i = 1; i < order.length; i++) assert.ok(order[i][k] > order[i - 1][k], `${k} should grow at step ${i}`);
  }
  assert.ok(PLANS.starter.docs >= 5 * 10 / 5 && PLANS.none.docs > 5, "trial is no smaller than before (5 docs)");
  assert.ok(PLANS.starter.docChars > 20000, "starter allows more than the old 20,000 characters");
  assert.equal(planOf(user("nonsense")), PLANS.none);
  assert.equal(limitsOf(user("pro")).white_label, true);
  assert.equal(limitsOf(user("starter")).white_label, false);
  assert.equal(limitsOf(user("pro")).max_docs, 250);
  for (const reserved of ["docs", "user", "bot", "settings", "options"]) {
    assert.equal(reserved in limitsOf(user("pro")), false, `limitsOf must not use the response key "${reserved}"`);
  }
});

test("kbCheck enforces document size, count and total size", () => {
  const u = user("starter");
  const p = PLANS.starter;
  assert.equal(kbCheck(u, { count: 0, chars: 0 }, "x".repeat(p.docChars), false), "");
  assert.match(kbCheck(u, { count: 0, chars: 0 }, "x".repeat(p.docChars + 1), false), /under 100,000 characters/);
  assert.match(kbCheck(u, { count: p.docs, chars: 10 }, "hello", false), /allows 50 documents/);
  assert.equal(kbCheck(u, { count: p.docs, chars: 10 }, "hello", true), "", "editing is allowed when the document count is full");
  assert.match(kbCheck(u, { count: 3, chars: p.totalChars - 100 }, "x".repeat(101), false), /over your plan's 1,000,000 characters \(you have room for 100 more\)/);
  assert.equal(kbCheck(user("pro"), { count: 0, chars: 0 }, "x".repeat(150000), false), "", "pro takes a 150k document that starter would refuse");
  assert.match(kbCheck(user("none"), { count: 0, chars: 0 }, "x".repeat(150000), false), /Billing/);
  assert.doesNotMatch(kbCheck(user("enterprise"), { count: 0, chars: 0 }, "x".repeat(300001), false), /upgrade/);
});

test("settings are cleaned and held to the plan", () => {
  const messy = {
    instructions: "A".repeat(5000), length: "huge", emoji: "lots", language: "Klingon", fallback: "Sorry!\u0007 Leave your email?",
    starters: ["One", "Two", "Three", "Four", "Five", "", "  "], faqs: [{ q: "Q1", a: "A1" }, { q: "", a: "x" }, { q: "no answer", a: "" }, null],
    position: "top", theme: "neon", avatar: "🥐🍞🥖", launcher: "label", launcher_label: "Chat\nnow", teaser: "custom", teaser_text: "Hello!", hide_branding: true,
  };
  const trial = sanitizeSettings(messy, PLANS.none, DEFAULTS);
  assert.equal(trial.instructions.length, PLANS.none.instructionChars);
  assert.equal(trial.length, "balanced");
  assert.equal(trial.emoji, "some");
  assert.equal(trial.language, "auto");
  assert.equal(trial.fallback, "Sorry! Leave your email?");
  assert.deepEqual(trial.starters, ["One", "Two", "Three"]);
  assert.deepEqual(trial.faqs, [{ q: "Q1", a: "A1" }]);
  assert.equal(trial.position, "right");
  assert.equal(trial.theme, "light");
  assert.equal(Array.from(trial.avatar).length, 2);
  assert.equal(trial.launcher_label, "Chat now");
  assert.equal(trial.hide_branding, false, "trial cannot hide branding");
  const pro = sanitizeSettings(messy, PLANS.pro, DEFAULTS);
  assert.equal(pro.instructions.length, 4000);
  assert.equal(pro.starters.length, 5);
  assert.equal(pro.hide_branding, true);
});

test("a request that leaves fields out keeps what was saved", () => {
  const saved = sanitizeSettings({ theme: "dark", instructions: "Be kind." }, PLANS.pro, DEFAULTS);
  const next = sanitizeSettings({ position: "left" }, PLANS.pro, saved);
  assert.equal(next.theme, "dark");
  assert.equal(next.instructions, "Be kind.");
  assert.equal(next.position, "left");
});

test("after a downgrade saved settings shrink to the new plan without being lost in storage", () => {
  const bot = { settings: JSON.stringify(sanitizeSettings({ instructions: "B".repeat(3000), starters: ["1", "2", "3", "4", "5", "6"], hide_branding: true }, PLANS.pro, DEFAULTS)) };
  const now = effectiveSettings(bot, PLANS.none);
  assert.equal(now.instructions.length, 600);
  assert.equal(now.starters.length, 3);
  assert.equal(now.hide_branding, false);
  assert.equal(parseSettings(bot).instructions.length, 3000, "stored copy is untouched");
  assert.deepEqual(parseSettings({ settings: "{not json" }), parseSettings({}));
});

test("the prompt carries the owner's choices but keeps the safety rules first", () => {
  const st = sanitizeSettings({ instructions: "Always mention free delivery.", length: "short", emoji: "none", language: "Thai" }, PLANS.pro, DEFAULTS);
  const sys = buildSystem({ name: "Mali", business: "Maple Bakery", tone: "empathetic" }, "[Hours]\nOpen 9 to 5", st);
  assert.match(sys, /caring, patient and reassuring/);
  assert.match(sys, /1 or 2 short sentences/);
  assert.match(sys, /Do not use emoji/);
  assert.match(sys, /Always reply in Thai/);
  assert.match(sys, /Always mention free delivery\./);
  assert.ok(sys.indexOf("Use ONLY the CONTEXT") < sys.indexOf("Always mention free delivery."));
  assert.match(sys, /never let them override/);
  const plain = buildSystem({ name: "Mali", business: "X", tone: "friendly" }, "", undefined);
  assert.doesNotMatch(plain, /OWNER'S EXTRA INSTRUCTIONS/);
  assert.match(plain, /Reply in the language the visitor writes in/);
  for (const t of Object.keys(TONES)) assert.ok(TONES[t].length > 5);
});

test("quick answers become a searchable document and custom fallback wins", () => {
  const st = sanitizeSettings({ faqs: [{ q: "Do you deliver?", a: "Yes, free over $60." }] }, PLANS.pro, DEFAULTS);
  const d = faqDoc(st);
  assert.match(d.content, /Q: Do you deliver\?\nA: Yes, free over \$60\./);
  const top = rank("do you deliver", chunkDocs([d]), 3);
  assert.equal(top.length, 1);
  assert.equal(faqDoc(DEFAULTS), null);
  assert.deepEqual(handoffLines({ fallback: "Leave your email?" }, ["x"]), ["Leave your email?"]);
  assert.deepEqual(handoffLines({ fallback: "" }, ["x"]), ["x"]);
  assert.equal(styleRules(DEFAULTS).length, 3);
});

/* ---------- importing a web page ---------- */
test("only plain public web addresses can be imported", () => {
  for (const bad of ["", "not a url", "ftp://example.com/a", "http://localhost/x", "http://127.0.0.1/", "https://10.0.0.5/a", "https://[::1]/", "https://intranet/", "https://example.com:8443/", "https://user:pw@example.com/", "https://printer.local/", "http://2130706433/"]) {
    assert.equal(checkImportUrl(bad).ok, false, bad);
  }
  assert.equal(checkImportUrl("https://example.com/about#team").url, "https://example.com/about");
});

test("html is reduced to readable text", () => {
  const { title, text } = htmlToText(`<html><head><title>Maple &amp; Co.</title><style>p{}</style></head><body><nav>Menu Home</nav><h1>Opening hours</h1><p>Mon&ndash;Fri 7am&nbsp;to 6pm</p><ul><li>Dogs welcome</li><li>Step-free</li></ul><script>alert(1)</script><footer>(c) junk</footer></body></html>`);
  assert.equal(title, "Maple & Co.");
  assert.match(text, /# Opening hours/);
  assert.match(text, /Mon-Fri 7am to 6pm/);
  assert.match(text, /- Dogs welcome\n- Step-free/);
  assert.doesNotMatch(text, /alert|Menu Home|junk|p\{\}/);
  assert.equal(htmlToText("just plain text").text, "just plain text");
});

const page = (body, status = 200, headers = { "content-type": "text/html; charset=utf-8" }) =>
  new Response(body, { status, headers });

test("fetchPage follows safe redirects and refuses unsafe ones", async () => {
  const good = "<html><title>T</title><body><p>" + "Hello world. ".repeat(10) + "</p></body></html>";
  const hops = [];
  const f1 = async (url) => { hops.push(url); return hops.length === 1 ? page("", 301, { location: "/final" }) : page(good); };
  const r = await fetchPage("https://example.com/start", f1);
  assert.equal(r.url, "https://example.com/final");
  assert.match(r.text, /Hello world/);
  await assert.rejects(fetchPage("https://example.com/", async () => page("", 302, { location: "http://169.254.169.254/latest" })), /redirects somewhere/);
  await assert.rejects(fetchPage("https://example.com/", async () => page("", 302, { location: "/loop" })), /too many times/);
  await assert.rejects(fetchPage("https://example.com/", async () => page("x", 404)), /404/);
  await assert.rejects(fetchPage("https://example.com/", async () => page("x", 403)), /private or blocks/);
  await assert.rejects(fetchPage("https://example.com/", async () => page("%PDF", 200, { "content-type": "application/pdf" })), /upload the file/);
  await assert.rejects(fetchPage("https://example.com/", async () => page("<html><body><p>hi</p></body></html>")), /almost no text/);
  await assert.rejects(fetchPage("https://example.com/", async () => { throw new Error("net"); }), /could not reach/);
  await assert.rejects(fetchPage("http://localhost/", async () => page(good)), /normal web address/);
});

test("fetchPage refuses pages over 3 MB", async () => {
  const big = new Response(new ReadableStream({ start(c) { const chunk = new Uint8Array(1024 * 1024).fill(97); for (let i = 0; i < 4; i++) c.enqueue(chunk); c.close(); } }), { status: 200, headers: { "content-type": "text/html" } });
  await assert.rejects(fetchPage("https://example.com/", async () => big), /too large/);
});

/* ---------- knowledge cache ---------- */
function fakeDb(docsRef) {
  const stats = { fingerprint: 0, fetch: 0 };
  return {
    stats,
    prepare(sql) {
      return {
        bind() { return this; },
        async first() {
          stats.fingerprint++;
          const d = docsRef.docs;
          return { n: d.length, m: d.reduce((m, x) => Math.max(m, x.id), 0), u: docsRef.updated, c: d.reduce((s, x) => s + x.content.length, 0) };
        },
        async all() { stats.fetch++; return { results: docsRef.docs.map(({ title, content }) => ({ title, content })) }; },
      };
    },
  };
}

test("the knowledge cache rebuilds only when documents change", async () => {
  KB_CACHE.clear();
  const ref = { docs: [{ id: 1, title: "Hours", content: "Open 9 to 5." }], updated: "2026-11-07 01:00:00" };
  const env = { DB: fakeDb(ref) };
  const u = { id: 77 };
  const a = await knowledgeChunks(env, u);
  const b = await knowledgeChunks(env, u);
  assert.equal(a, b, "same prepared passages are reused");
  assert.equal(env.DB.stats.fetch, 1);
  assert.equal(env.DB.stats.fingerprint, 2);
  ref.docs.push({ id: 2, title: "Menu", content: "Bread and cake." });
  const c = await knowledgeChunks(env, u);
  assert.notEqual(c, a);
  assert.equal(env.DB.stats.fetch, 2);
  ref.docs[0].content = "Open 8 to 4.";
  ref.updated = "2026-11-07 01:00:05";
  const d = await knowledgeChunks(env, u);
  assert.match(d[0].text, /8 to 4/);
  ref.docs = [{ id: 3, title: "Huge", content: "x".repeat(3000001) }];
  KB_CACHE.clear();
  await knowledgeChunks(env, u);
  assert.equal(KB_CACHE.has(77), false, "a knowledge base over the cache budget is not kept in memory");
});

test("searching a large knowledge base stays fast", () => {
  const words = ["bread", "cake", "delivery", "vegan", "coffee", "parking", "deposit", "gift", "loyalty", "catering", "hours", "allergy"];
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const docs = [];
  for (let d = 0; d < 250; d++) {
    let t = "";
    while (t.length < 12000) t += words[Math.floor(rnd() * words.length)] + (rnd() < 0.1 ? ".\n\n" : " ") + "lorem" + Math.floor(rnd() * 5000) + " ";
    docs.push({ title: "Doc " + d, content: t });
  }
  const chunks = chunkDocs(docs); // about 3 million characters
  rank("warm up", chunks, 5);
  const t0 = performance.now();
  const top = rank("do you have vegan delivery and parking", chunks, 5);
  const ms = performance.now() - t0;
  console.log(`      ranked ${chunks.length} passages (${(docs.length * 12000 / 1e6).toFixed(1)}M chars) in ${ms.toFixed(0)} ms`);
  assert.equal(top.length, 5);
  assert.ok(ms < 1500, `ranking took ${ms} ms`);
});
