/*! Bubble5 live chat bubble: visitors talk to a real person. */
(function () {
  var s = document.currentScript;
  if (!s || window.__b5live) return;
  window.__b5live = true;
  var api = (s.getAttribute("data-api") || new URL(s.src).origin).replace(/\/$/, "");
  var KEY = "b5_live";
  var saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) {}
  var vid = (saved && saved.vid) || "v" + Math.random().toString(36).slice(2, 12);
  var chat = saved && saved.chat_id ? { id: saved.chat_id, token: saved.token } : null;
  var lastId = (saved && saved.last) || 0;
  var online = false, openState = false, unread = 0, pollTimer = null, idleSince = Date.now();
  var shown = {};
  var aiHist = [];
  try { aiHist = JSON.parse(sessionStorage.getItem("b5_ai") || "[]"); } catch (e) {}
  var AI_CHIPS = ["How much does it cost?", "How does setup work?", "Is there a free trial?", "Which languages does it speak?"];

  function persist() { try { localStorage.setItem(KEY, JSON.stringify({ vid: vid, chat_id: chat && chat.id, token: chat && chat.token, last: lastId })); } catch (e) {} }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function get(path) { return fetch(api + path).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; }); }); }
  function post(path, body) { return fetch(api + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; }); }); }

  var host = document.createElement("div");
  host.style.cssText = "all:initial;position:fixed;z-index:2147482999;right:0;bottom:0";
  document.body.appendChild(host);
  var root = host.attachShadow({ mode: "open" });
  var st = document.createElement("style");
  st.textContent =
    "*{box-sizing:border-box}.fab,.panel,input,textarea,button{font-family:'Figtree',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}" +
    ".fab{position:fixed;right:18px;bottom:18px;border:0;border-radius:999px;background:#0E7C7B;color:#fff;cursor:pointer;box-shadow:0 8px 24px rgba(15,42,46,.3);display:flex;align-items:center;gap:10px;padding:0 20px 0 16px;height:56px;font-weight:700;font-size:15px}" +
    ".fab:hover{background:#0A5F5E}.fab:focus-visible,button:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid #FFC53D;outline-offset:2px}" +
    ".fab svg{width:24px;height:24px}.dot{width:10px;height:10px;border-radius:50%;background:#9aa;display:inline-block}.dot.on{background:#3ddc84;box-shadow:0 0 0 3px rgba(61,220,132,.3)}" +
    ".badge{background:#FFC53D;color:#0F2A2E;border-radius:999px;font-size:12px;min-width:20px;height:20px;display:none;align-items:center;justify-content:center;padding:0 6px}.badge.show{display:inline-flex}" +
    ".panel{position:fixed;right:18px;bottom:86px;width:360px;max-width:calc(100vw - 24px);height:520px;max-height:calc(100vh - 110px);background:#fff;color:#0F2A2E;border-radius:18px;box-shadow:0 18px 60px rgba(15,42,46,.35);display:none;flex-direction:column;overflow:hidden}" +
    ".panel.open{display:flex}" +
    "header{background:#0E7C7B;color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px}header b{font-size:16px;display:block}header small{font-size:12.5px;opacity:.92;display:flex;align-items:center;gap:6px}header .x{margin-left:auto;background:transparent;border:0;color:#fff;font-size:28px;line-height:1;cursor:pointer;padding:4px 8px}" +
    ".log{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px;background:#E8F3F1}" +
    ".m{max-width:84%;padding:9px 13px;border-radius:16px;font-size:15px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}" +
    ".m.agent{background:#fff;border:1px solid #CFE0DC;border-bottom-left-radius:5px;align-self:flex-start}.m.visitor{background:#0E7C7B;color:#fff;border-bottom-right-radius:5px;align-self:flex-end}.m.sys{align-self:center;background:transparent;color:#3C5558;font-size:13px;text-align:center;max-width:94%}" +
    "form{display:flex;gap:8px;padding:10px;border-top:1px solid #CFE0DC;background:#fff;align-items:flex-end}" +
    "input,textarea{flex:1;border:1.5px solid #CFE0DC;border-radius:12px;padding:10px 12px;font:inherit;font-size:16px;min-width:0;width:100%;color:#0F2A2E}" +
    "textarea{resize:none;min-height:44px}.start{padding:16px;display:flex;flex-direction:column;gap:4px;overflow-y:auto;flex:1;background:#E8F3F1}.start input,.start textarea{flex:none;height:46px;margin-bottom:10px}.start textarea{height:96px;padding-top:11px;line-height:1.4}.start .go{margin-top:6px;flex:none}.start p{font-size:14.5px;line-height:1.45;color:#0F2A2E;margin:0 0 10px}.start label{font-size:13px;font-weight:600;margin:0 0 2px}" +
    "button.send,button.go{border:0;border-radius:12px;background:#0E7C7B;color:#fff;padding:0 16px;height:44px;font-weight:700;cursor:pointer;font-size:15px}button.go{width:100%}button:disabled{opacity:.55;cursor:default}.err{color:#B42318;font-size:13.5px;min-height:1em}" +
    ".hp{position:absolute;left:-9999px;opacity:0}" +
    ".bar{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px;background:#fff;border-bottom:1px solid #CFE0DC;font-size:13px;color:#3C5558}.bar button{border:1.5px solid #0E7C7B;background:#fff;color:#0A5F5E;border-radius:999px;padding:6px 12px;font-weight:700;font-size:13px;cursor:pointer}.bar button:hover{background:#0E7C7B;color:#fff}" +
    ".chips{display:flex;flex-wrap:wrap;gap:6px;align-self:flex-start}.chips button{border:1.5px solid #CFE0DC;background:#fff;color:#0F2A2E;border-radius:999px;padding:7px 12px;font-size:13.5px;cursor:pointer}.chips button:hover{border-color:#0E7C7B}" +
    ".tag{align-self:flex-start;font-size:11.5px;color:#3C5558;margin:-4px 0 0 6px}.handoff{align-self:flex-start;border:0;background:#0E7C7B;color:#fff;border-radius:12px;padding:10px 14px;font-weight:700;font-size:14px;cursor:pointer}.dots span{display:inline-block;width:7px;height:7px;margin:0 2px;border-radius:50%;background:#9aa;animation:b 1.2s infinite}.dots span:nth-child(2){animation-delay:.15s}.dots span:nth-child(3){animation-delay:.3s}@keyframes b{0%,60%,100%{transform:translateY(0);opacity:.5}30%{transform:translateY(-4px);opacity:1}}" +
    "@media(max-width:480px){.panel{right:0;bottom:0;width:100vw;max-width:100vw;height:100%;max-height:100%;border-radius:0}.fab{right:14px;bottom:14px}}" +
    "@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}";
  root.appendChild(st);

  var fab = el("button", "fab"); fab.setAttribute("aria-label", "Chat with us");
  fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>';
  fab.appendChild(el("span", null, "Chat with us"));
  var badge = el("span", "badge"); fab.appendChild(badge);
  var panel = el("div", "panel"); panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Chat with the Bubble5 team");
  var head = el("header"); var ht = el("div"); ht.appendChild(el("b", null, "Ask Bubble5"));
  var status = el("small"); var sdot = el("span", "dot"); var stext = el("span", null, "Checking…"); status.appendChild(sdot); status.appendChild(stext); ht.appendChild(status); head.appendChild(ht);
  var close = el("button", "x", "×"); close.setAttribute("aria-label", "Close chat"); head.appendChild(close);
  var body = el("div"); body.style.cssText = "display:flex;flex-direction:column;flex:1;min-height:0";
  panel.appendChild(head); panel.appendChild(body);
  root.appendChild(panel); root.appendChild(fab);

  function setOnline(v) {
    online = !!v; sdot.className = "dot" + (online ? " on" : "");
    stext.textContent = online ? "AI answers now. Team is online" : "AI answers now. Team replies by email";
    var f = root.querySelector("#b5email"); if (f) f.placeholder = online ? "Your email (optional)" : "Your email (so we can reply)";
  }

  function setBadge() { badge.textContent = unread; badge.className = "badge" + (unread && !openState ? " show" : ""); }

  function showStart(prefill, transcript) {
    body.innerHTML = "";
    var f = el("div", "start");
    f.appendChild(el("p", null, transcript ? "No problem, I'll pass this conversation to the team so you don't have to repeat yourself. A real person will reply." : "Hi! Send us a message and a real person will reply. We usually answer within minutes when we're online."));
    var l1 = el("label", null, "Your name"); l1.htmlFor = "b5name"; var name = el("input"); name.id = "b5name"; name.placeholder = "Optional"; name.autocomplete = "name"; name.maxLength = 80;
    var l2 = el("label", null, "Email"); l2.htmlFor = "b5email"; var email = el("input"); email.id = "b5email"; email.type = "email"; email.autocomplete = "email"; email.maxLength = 200;
    var l3 = el("label", null, "Message"); l3.htmlFor = "b5msg"; var msg = el("textarea"); msg.id = "b5msg"; msg.rows = 3; msg.maxLength = 1000; msg.placeholder = "How can we help?"; if (prefill) msg.value = prefill;
    var hp = el("input", "hp"); hp.tabIndex = -1; hp.setAttribute("aria-hidden", "true"); hp.autocomplete = "off";
    var err = el("div", "err"); err.setAttribute("role", "alert");
    var go = el("button", "go", transcript ? "Send to the team" : "Start chat"); go.type = "button";
    [l1, name, l2, email, l3, msg, hp, err, go].forEach(function (x) { f.appendChild(x); });
    body.appendChild(f); setOnline(online);
    go.onclick = function () {
      err.textContent = "";
      if (!msg.value.trim()) { err.textContent = "Please type a message."; return; }
      if (!online && !email.value.trim()) { err.textContent = "Please add your email so we can reply."; return; }
      go.disabled = true;
      post("/live/start", { visitor: vid, name: name.value, email: email.value, message: msg.value, website: hp.value, transcript: transcript || [] }).then(function (r) {
        if (!r.ok) { err.textContent = r.j.error || "Could not send. Please try again."; go.disabled = false; return; }
        chat = { id: r.j.chat_id, token: r.j.token }; lastId = 0; shown = {}; persist(); showThread(true);
      }).catch(function () { err.textContent = "Could not reach us. Please try again."; go.disabled = false; });
    };
  }


  var aiLog, aiInput, aiBusy = false;
  function saveAi() { try { sessionStorage.setItem("b5_ai", JSON.stringify(aiHist.slice(-12))); } catch (e) {} }
  function lastQuestion() { for (var i = aiHist.length - 1; i >= 0; i--) if (aiHist[i].role === "user") return aiHist[i].content; return ""; }
  function toHuman() { showStart(lastQuestion(), aiHist.slice(-8)); }
  function aiAdd(role, text) { var d = el("div", "m " + (role === "user" ? "visitor" : "agent"), text); aiLog.appendChild(d); aiLog.scrollTop = aiLog.scrollHeight; return d; }
  function aiHandoffBtn() { var b = el("button", "handoff", "Talk to a person"); b.type = "button"; b.onclick = toHuman; aiLog.appendChild(b); aiLog.scrollTop = aiLog.scrollHeight; }
  function showAI() {
    body.innerHTML = "";
    var bar = el("div", "bar"); bar.appendChild(el("span", null, "AI assistant. A person can step in."));
    var hb = el("button", null, "Talk to a person"); hb.type = "button"; hb.onclick = toHuman; bar.appendChild(hb);
    aiLog = el("div", "log"); aiLog.setAttribute("aria-live", "polite");
    var form = el("form"); aiInput = el("textarea"); aiInput.rows = 1; aiInput.maxLength = 500; aiInput.placeholder = "Ask a question\u2026"; aiInput.setAttribute("aria-label", "Your question");
    var send = el("button", "send", "Send"); send.type = "submit"; form.appendChild(aiInput); form.appendChild(send);
    body.appendChild(bar); body.appendChild(aiLog); body.appendChild(form);
    aiAdd("assistant", "Hi! I'm the Bubble5 assistant. Ask me anything about pricing, setup or how it works. If I can't help, I'll hand you to a real person.");
    aiHist.forEach(function (m) { aiAdd(m.role, m.content); });
    var chips = null;
    if (!aiHist.length) { chips = el("div", "chips"); AI_CHIPS.forEach(function (q) { var c = el("button", null, q); c.type = "button"; c.onclick = function () { ask(q); }; chips.appendChild(c); }); aiLog.appendChild(chips); }
    aiInput.onkeydown = function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } };
    form.onsubmit = function (e) { e.preventDefault(); var t = aiInput.value.trim(); if (t) { aiInput.value = ""; ask(t); } };
    function ask(q) {
      if (aiBusy) return; aiBusy = true; if (chips) { chips.remove(); chips = null; }
      aiAdd("user", q); aiHist.push({ role: "user", content: q });
      var wait = el("div", "m agent dots"); wait.innerHTML = "<span></span><span></span><span></span>"; aiLog.appendChild(wait); aiLog.scrollTop = aiLog.scrollHeight;
      var ctl = new AbortController(); var to = setTimeout(function () { ctl.abort(); }, 40000);
      fetch(api + "/support/chat", { method: "POST", headers: { "Content-Type": "application/json" }, signal: ctl.signal, body: JSON.stringify({ messages: aiHist.slice(-8) }) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          wait.remove();
          var a = res.j.answer || res.j.message || "Sorry, something went wrong.";
          aiAdd("assistant", a); aiHist.push({ role: "assistant", content: a });
          if (res.j.handoff || !res.ok) aiHandoffBtn();
        })
        .catch(function () { wait.remove(); aiAdd("assistant", "Sorry, I couldn't reach the assistant. You can talk to a person instead."); aiHandoffBtn(); })
        .then(function () { clearTimeout(to); aiBusy = false; saveAi(); aiInput.focus(); });
    }
    setTimeout(function () { aiInput.focus(); }, 50);
  }

  var log, input;
  function addMsg(m) {
    if (shown[m.id]) return; shown[m.id] = 1; if (m.id > lastId) lastId = m.id;
    var d = el("div", "m " + (m.sender === "agent" ? "agent" : "visitor"), m.body); log.appendChild(d); log.scrollTop = log.scrollHeight;
  }
  function showThread(fresh) {
    body.innerHTML = ""; log = el("div", "log"); log.setAttribute("aria-live", "polite");
    var form = el("form"); input = el("textarea"); input.rows = 1; input.maxLength = 1000; input.placeholder = "Type a message…"; input.setAttribute("aria-label", "Your message");
    var send = el("button", "send", "Send"); send.type = "submit"; form.appendChild(input); form.appendChild(send);
    body.appendChild(log); body.appendChild(form);
    input.onkeydown = function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } };
    form.onsubmit = function (e) {
      e.preventDefault(); var t = input.value.trim(); if (!t) return; input.value = ""; send.disabled = true; idleSince = Date.now();
      post("/live/send", { chat_id: chat.id, token: chat.token, message: t }).then(function (r) {
        if (r.status === 404) { chat = null; persist(); showAI(); return; }
        if (!r.ok) { addSys(r.j.error || "Could not send."); input.value = t; return; }
        setOnline(r.j.online); poll();
      }).catch(function () { addSys("Could not send. Check your connection."); input.value = t; }).then(function () { send.disabled = false; input.focus(); });
    };
    addSys(online ? "You're connected. We'll reply here." : "We're away right now. We'll reply here, or by email if you've left it.");
    shown = {}; lastId = 0; poll(true);
    setTimeout(function () { input.focus(); }, 50);
  }
  function addSys(t) { var d = el("div", "m sys", t); if (log) { log.appendChild(d); log.scrollTop = log.scrollHeight; } }

  function poll(all) {
    if (!chat) return;
    get("/live/poll?chat_id=" + chat.id + "&token=" + encodeURIComponent(chat.token) + "&after=" + (all ? 0 : lastId)).then(function (r) {
      if (r.status === 404) { chat = null; persist(); if (openState) showAI(); return; }
      if (!r.ok) return;
      setOnline(r.j.online);
      var n = 0;
      (r.j.messages || []).forEach(function (m) { if (openState && log) addMsg(m); else if (m.id > lastId && m.sender === "agent") { n++; } });
      if (!openState && n) { unread += n; setBadge(); }
      if (!openState) (r.j.messages || []).forEach(function (m) { if (m.id > lastId) lastId = m.id; });
      persist();
    }).catch(function () {});
  }
  function schedule() {
    clearTimeout(pollTimer);
    var idle = (Date.now() - idleSince) / 1000;
    var wait = document.hidden ? 20000 : openState ? (idle < 120 ? 3500 : 9000) : 15000;
    pollTimer = setTimeout(function () { if (chat) poll(openState && !log ? true : false); schedule(); }, wait);
  }

  function open() {
    openState = true; unread = 0; setBadge(); panel.classList.add("open"); fab.style.display = "none"; idleSince = Date.now();
    get("/live/status").then(function (r) { if (r.ok) setOnline(r.j.online); }).catch(function () {});
    if (chat) { lastId = 0; shown = {}; showThread(); } else showAI();
    schedule();
  }
  function shut() { openState = false; panel.classList.remove("open"); fab.style.display = ""; fab.focus(); if (chat) { lastId = lastId; } schedule(); }
  fab.onclick = open; close.onclick = shut;
  root.addEventListener("keydown", function (e) { if (e.key === "Escape") shut(); });
  document.addEventListener("visibilitychange", schedule);
  get("/live/status").then(function (r) { if (r.ok) setOnline(r.j.online); }).catch(function () {});
  if (chat) schedule();
})();
