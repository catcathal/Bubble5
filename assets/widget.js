/*! Bubble5 chat widget. Add to any site:
    <script src="https://bubble5.online/assets/widget.js" data-key="bk_..." defer></script> */
(function () {
  var s = document.currentScript;
  if (!s || window.__bubble5) return;
  var key = s.getAttribute("data-key");
  if (!key) return;
  window.__bubble5 = true;
  var base = (s.getAttribute("data-api") || new URL(s.src).origin).replace(/\/$/, "");
  var api = base + "/bot/" + encodeURIComponent(key);
  var store = function (k, v) { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (e) {} return null; };
  var vid = null;
  try { vid = localStorage.getItem("b5_vid"); if (!vid) { vid = "v" + Math.random().toString(36).slice(2, 12); localStorage.setItem("b5_vid", vid); } } catch (e) { vid = "v" + Math.random().toString(36).slice(2, 12); }
  var history = [];
  try { history = JSON.parse(store("b5_h_" + key) || "[]"); } catch (e) {}

  fetch(api + "/config").then(function (r) { return r.ok ? r.json() : null; }).then(function (cfg) {
    if (!cfg || !cfg.enabled || cfg.allowed === false) return;
    build(cfg);
  }).catch(function () {});

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function build(cfg) {
    var host = document.createElement("div");
    host.style.cssText = "all:initial;position:fixed;z-index:2147483000;right:0;bottom:0";
    document.body.appendChild(host);
    var root = host.attachShadow({ mode: "open" });
    var color = /^#[0-9a-f]{6}$/i.test(cfg.color) ? cfg.color : "#6d4aff";
    var st = document.createElement("style");
    st.textContent =
      "*{box-sizing:border-box}.fab,.panel,input,textarea,button{font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}" +
      ".fab{position:fixed;right:18px;bottom:18px;width:58px;height:58px;border:0;border-radius:50%;background:" + color + ";color:#fff;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.25);display:grid;place-items:center;transition:transform .15s}" +
      ".fab:hover{transform:scale(1.06)}.fab:focus-visible,button:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid #fff;outline-offset:-5px;box-shadow:0 0 0 3px " + color + "}" +
      ".fab svg{width:28px;height:28px}" +
      ".panel{position:fixed;right:18px;bottom:88px;width:370px;max-width:calc(100vw - 24px);height:560px;max-height:calc(100vh - 110px);background:#fff;color:#1b1b24;border-radius:18px;box-shadow:0 18px 60px rgba(0,0,0,.3);display:none;flex-direction:column;overflow:hidden}" +
      ".panel.open{display:flex;animation:pop .18s ease-out}@keyframes pop{from{opacity:0;transform:translateY(10px) scale(.98)}}" +
      "header{background:" + color + ";color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px}" +
      "header b{font-size:15px;display:block}header small{opacity:.85;font-size:12px}header .x{margin-left:auto;background:transparent;border:0;color:#fff;font-size:26px;line-height:1;cursor:pointer;padding:4px 8px}" +
      ".av{width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,.22);display:grid;place-items:center;font-weight:700}" +
      ".log{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px;background:#f6f6fa}" +
      ".m{max-width:84%;padding:9px 13px;border-radius:16px;font-size:14.5px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}" +
      ".m.a{background:#fff;border:1px solid #e6e6ee;border-bottom-left-radius:5px;align-self:flex-start}" +
      ".m.u{background:" + color + ";color:#fff;border-bottom-right-radius:5px;align-self:flex-end}" +
      ".dots span{display:inline-block;width:7px;height:7px;margin:0 2px;border-radius:50%;background:#9a9aae;animation:b 1.2s infinite}.dots span:nth-child(2){animation-delay:.15s}.dots span:nth-child(3){animation-delay:.3s}@keyframes b{0%,60%,100%{transform:translateY(0);opacity:.5}30%{transform:translateY(-4px);opacity:1}}" +
      "form{display:flex;gap:8px;padding:10px;border-top:1px solid #e6e6ee;background:#fff}" +
      "input,textarea{flex:1;border:1px solid #d6d6e0;border-radius:12px;padding:10px 12px;font:inherit;font-size:16px;min-width:0}" +
      "button.send{border:0;border-radius:12px;background:" + color + ";color:#fff;padding:0 16px;font-weight:600;cursor:pointer;font-size:14px}button:disabled{opacity:.5;cursor:default}" +
      ".lead{background:#fff;border:1px solid #e6e6ee;border-radius:14px;padding:10px;display:flex;flex-direction:column;gap:6px;align-self:stretch}.lead input,.lead textarea{flex:none;width:100%;font-size:14px;padding:8px 10px}" +
      ".lead .ok{color:#177a3c;font-size:14px}.pw{text-align:center;font-size:11px;padding:5px;color:#8a8a9a;background:#fff}.pw a{color:inherit}" +
      ".m{animation:in .22s ease-out}@keyframes in{from{opacity:0;transform:translateY(6px)}}" +
      ".chips{display:flex;flex-wrap:wrap;gap:6px;align-self:flex-start;max-width:92%}.chips button{border:1.5px solid " + color + ";background:#fff;color:" + color + ";border-radius:999px;padding:6px 12px;font-size:13.5px;font-weight:600;cursor:pointer;transition:background .12s,color .12s}.chips button:hover{background:" + color + ";color:#fff}" +
      ".online{display:inline-block;width:8px;height:8px;border-radius:50%;background:#4ade80;margin-right:5px;vertical-align:1px}" +
      ".teaser{position:fixed;right:84px;bottom:28px;max-width:230px;background:#fff;color:#1b1b24;border-radius:16px 16px 4px 16px;padding:11px 30px 11px 14px;font-size:14px;line-height:1.4;box-shadow:0 8px 28px rgba(0,0,0,.22);cursor:pointer;animation:in .3s ease-out}.teaser i{position:absolute;right:6px;top:3px;font-style:normal;font-size:18px;color:#8a8a9a;padding:2px 5px}" +
      ".book{background:#fff;border:2px solid " + color + ";border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:6px;align-self:stretch}.book b{font-size:14px}.book input,.book textarea{flex:none;width:100%;font-size:14px;padding:8px 10px}" +
      "@media(max-width:480px){.teaser{right:78px;bottom:22px}.panel{right:0;bottom:0;width:100vw;max-width:100vw;height:100%;max-height:100%;border-radius:0}.fab{right:14px;bottom:14px}}" +
      "@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}";
    root.appendChild(st);

    var fab = el("button", "fab");
    fab.setAttribute("aria-label", "Open chat");
    fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>';
    var panel = el("div", "panel"); panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Chat with " + cfg.name);
    var head = el("header");
    head.appendChild(el("div", "av", (cfg.name || "A").charAt(0).toUpperCase()));
    var ht = el("div"); ht.appendChild(el("b", null, cfg.name)); var sm = el("small"); sm.appendChild(el("span", "online")); sm.appendChild(document.createTextNode("Online \u00b7 replies instantly")); ht.appendChild(sm); head.appendChild(ht);
    var close = el("button", "x", "\u00d7"); close.setAttribute("aria-label", "Close chat"); head.appendChild(close);
    var log = el("div", "log"); log.setAttribute("aria-live", "polite");
    var form = el("form");
    var input = el("input"); input.type = "text"; input.maxLength = 500; input.placeholder = "Type your question\u2026"; input.setAttribute("aria-label", "Your message"); input.autocomplete = "off";
    var send = el("button", "send", "Send"); send.type = "submit";
    form.appendChild(input); form.appendChild(send);
    var pw = el("div", "pw"); var a = el("a", null, "Powered by Bubble5"); a.href = "https://bubble5.online"; a.target = "_blank"; a.rel = "noopener"; pw.appendChild(a);
    panel.appendChild(head); panel.appendChild(log); panel.appendChild(form); panel.appendChild(pw);
    root.appendChild(panel); root.appendChild(fab);

    function fmt(m, text) {
      String(text).split("**").forEach(function (part, i) { if (!part) return; if (i % 2) m.appendChild(el("strong", null, part)); else m.appendChild(document.createTextNode(part)); });
    }
    function add(role, text) { var m = el("div", "m " + (role === "user" ? "u" : "a")); fmt(m, text); log.appendChild(m); log.scrollTop = log.scrollHeight; return m; }
    var chipBox = null;
    function showChips(list) {
      if (chipBox) { chipBox.remove(); chipBox = null; }
      if (!list || !list.length) return;
      chipBox = el("div", "chips");
      list.slice(0, 4).forEach(function (q) { var b = el("button", null, q); b.type = "button"; b.onclick = function () { ask(q); }; chipBox.appendChild(b); });
      log.appendChild(chipBox); log.scrollTop = log.scrollHeight;
    }
    function bookCard() {
      if (log.querySelector(".book")) return;
      var box = el("div", "book");
      box.appendChild(el("b", null, "Request a booking"));
      var n = el("input"); n.placeholder = "Your name"; n.setAttribute("aria-label", "Your name");
      var e = el("input"); e.type = "email"; e.placeholder = "Email"; e.setAttribute("aria-label", "Your email");
      var ph = el("input"); ph.type = "tel"; ph.placeholder = "Phone (optional)"; ph.setAttribute("aria-label", "Your phone");
      var t = el("textarea"); t.rows = 2; t.placeholder = "Preferred day and time, and anything we should know"; t.setAttribute("aria-label", "Preferred day and time");
      var b = el("button", "send", "Send request"); b.type = "button"; b.style.padding = "10px";
      var msg = el("div", "ok"); msg.style.color = "#b3261e";
      b.onclick = function () {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.value)) { msg.textContent = "Please enter a valid email."; return; }
        b.disabled = true;
        var body = "BOOKING REQUEST\nWhen: " + (t.value || "not given") + (ph.value ? "\nPhone: " + ph.value : "") + "\nAsked: " + lastQ;
        fetch(api + "/lead", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: n.value, email: e.value, message: body }) })
          .then(function (r) { if (!r.ok) throw 0; box.innerHTML = ""; box.appendChild(el("div", "ok", "Request sent! We\u2019ll confirm by email shortly.")); })
          .catch(function () { b.disabled = false; msg.textContent = "Could not send. Please try again."; });
      };
      [n, e, ph, t, b, msg].forEach(function (x) { box.appendChild(x); });
      log.appendChild(box); log.scrollTop = log.scrollHeight;
    }
    function save() { store("b5_h_" + key, JSON.stringify(history.slice(-12))); }
    var started = false;
    function open() {
      panel.classList.add("open"); fab.style.display = "none";
      hideTeaser();
      if (!started) { started = true; add("assistant", cfg.greeting); history.forEach(function (m) { add(m.role, m.content); }); if (!history.length) showChips(cfg.starters); }
      setTimeout(function () { input.focus(); }, 50);
    }
    function shut() { panel.classList.remove("open"); fab.style.display = ""; fab.focus(); }
    fab.onclick = open; close.onclick = shut;
    var teaser = null;
    function hideTeaser() { if (teaser) { teaser.remove(); teaser = null; } store("b5_t_" + key, "1"); }
    if (!store("b5_t_" + key) && !history.length) {
      setTimeout(function () {
        if (panel.classList.contains("open") || store("b5_t_" + key)) return;
        teaser = el("div", "teaser", "\uD83D\uDC4B Got a question? Ask me, I reply instantly, any time.");
        var x = el("i", null, "\u00d7"); x.setAttribute("aria-label", "Dismiss"); x.onclick = function (ev) { ev.stopPropagation(); hideTeaser(); }; teaser.appendChild(x);
        teaser.onclick = open; root.appendChild(teaser);
      }, 5000);
    }
    root.addEventListener("keydown", function (e) { if (e.key === "Escape") shut(); });
    if (history.length) { /* returning visitor: keep the button, open on click */ }

    function leadForm() {
      var box = el("div", "lead");
      box.appendChild(el("div", null, "Leave your details and the team will get back to you."));
      var n = el("input"); n.placeholder = "Your name"; n.setAttribute("aria-label", "Your name");
      var e = el("input"); e.type = "email"; e.placeholder = "Your email"; e.setAttribute("aria-label", "Your email"); e.required = true;
      var t = el("textarea"); t.rows = 2; t.placeholder = "Your question (optional)"; t.setAttribute("aria-label", "Your question");
      var b = el("button", "send", "Send to the team"); b.type = "button"; b.style.padding = "10px";
      var msg = el("div", "ok"); msg.style.color = "#b3261e";
      b.onclick = function () {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.value)) { msg.textContent = "Please enter a valid email."; return; }
        b.disabled = true;
        fetch(api + "/lead", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: n.value, email: e.value, message: t.value || lastQ }) })
          .then(function (r) { if (!r.ok) throw 0; box.innerHTML = ""; box.appendChild(el("div", "ok", "Thank you! We will be in touch soon.")); })
          .catch(function () { b.disabled = false; msg.textContent = "Could not send. Please try again."; });
      };
      [n, e, t, b, msg].forEach(function (x) { box.appendChild(x); });
      log.appendChild(box); log.scrollTop = log.scrollHeight;
    }

    var busy = false, lastQ = "";
    function ask(q) {
      if (!q || busy) return;
      busy = true; send.disabled = true; lastQ = q; showChips([]);
      add("user", q); history.push({ role: "user", content: q });
      var wait = el("div", "m a dots"); wait.innerHTML = "<span></span><span></span><span></span>"; log.appendChild(wait); log.scrollTop = log.scrollHeight;
      var ctl = new AbortController(); var to = setTimeout(function () { ctl.abort(); }, 40000);
      fetch(api + "/chat", { method: "POST", headers: { "Content-Type": "application/json" }, signal: ctl.signal, body: JSON.stringify({ visitor: vid, messages: history.slice(-8) }) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          wait.remove();
          if (res.ok) {
            add("assistant", res.j.answer); history.push({ role: "assistant", content: res.j.answer });
            if (res.j.handoff && !log.querySelector(".lead")) leadForm();
            else if (res.j.action === "book") bookCard();
            else showChips(res.j.chips);
          } else { add("assistant", res.j.message || res.j.error || "Sorry, something went wrong."); history.pop(); }
        })
        .catch(function () { wait.remove(); add("assistant", "Sorry, I could not reach the assistant. Please try again."); history.pop(); })
        .then(function () { clearTimeout(to); busy = false; send.disabled = false; save(); input.focus(); });
    }
    form.onsubmit = function (ev) { ev.preventDefault(); var q = input.value.trim(); if (!q) return; input.value = ""; ask(q); };
  }
})();
