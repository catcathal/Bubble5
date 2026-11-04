/* Bubble5 language picker.
   A globe button next to the menu. Choosing a language translates the whole page with Google Translate
   (the page is only sent to Google when a visitor picks a language other than English).
   The picker, not Google's own toolbar, is what visitors see. */
(function () {
  "use strict";
  var LANGS = [
    ["en", "English"], ["es", "Español"], ["fr", "Français"], ["de", "Deutsch"], ["pt", "Português"], ["it", "Italiano"],
    ["nl", "Nederlands"], ["sv", "Svenska"], ["pl", "Polski"], ["tr", "Türkçe"], ["ru", "Русский"], ["uk", "Українська"],
    ["el", "Ελληνικά"], ["ar", "العربية"], ["iw", "עברית"], ["hi", "हिन्दी"], ["bn", "বাংলা"], ["th", "ไทย"], ["vi", "Tiếng Việt"],
    ["id", "Bahasa Indonesia"], ["ms", "Bahasa Melayu"], ["tl", "Filipino"], ["zh-CN", "简体中文"], ["zh-TW", "繁體中文"],
    ["ja", "日本語"], ["ko", "한국어"]
  ];
  var SHORT = { "zh-CN": "ZH", "zh-TW": "繁", iw: "HE", tl: "FIL" };

  function readCookie() {
    var m = document.cookie.match(/(?:^|;\s*)googtrans=\/[^\/]*\/([^;]+)/);
    return m ? decodeURIComponent(m[1]) : "en";
  }
  function writeCookie(code) {
    var host = location.hostname, parts = host.split("."), roots = [null, host];
    if (parts.length > 2) roots.push("." + parts.slice(-2).join("."));
    roots.forEach(function (d) {
      var base = "googtrans=" + (code === "en" ? "" : "/en/" + code) + "; path=/" + (d ? "; domain=" + d : "");
      document.cookie = code === "en" ? base + "; expires=Thu, 01 Jan 1970 00:00:00 GMT" : base;
    });
    try { localStorage.setItem("b5_lang", code); } catch (e) { /* storage unavailable */ }
  }
  var current = readCookie();
  if (!LANGS.some(function (l) { return l[0] === current; })) current = "en";

  /* ---- styles ---- */
  var css = document.createElement("style");
  css.textContent =
    ".lang{position:relative;display:inline-flex}" +
    ".lang-btn{display:inline-flex;align-items:center;gap:6px;min-height:42px;padding:0 12px;border:2px solid var(--ink,#0F2A2E);border-radius:999px;background:transparent;color:var(--ink,#0F2A2E);font:600 .92rem/1 var(--body,system-ui,sans-serif);cursor:pointer}" +
    ".lang-btn:hover{background:var(--mist,#E8F3F1)}.lang-btn svg{width:18px;height:18px;flex:none}" +
    ".lang-menu{position:absolute;top:calc(100% + 8px);right:0;z-index:300;width:240px;max-height:min(70vh,420px);overflow-y:auto;margin:0;padding:6px;list-style:none;background:#fff;border:1.5px solid var(--line,#CFE0DC);border-radius:16px;box-shadow:0 14px 40px rgba(15,42,46,.22)}" +
    ".lang-menu[hidden]{display:none}" +
    ".lang-menu li{margin:0}.lang-menu button{display:flex;width:100%;align-items:center;justify-content:space-between;gap:10px;min-height:44px;padding:0 12px;border:0;border-radius:10px;background:none;color:var(--ink,#0F2A2E);font:500 1rem/1.2 var(--body,system-ui,sans-serif);text-align:start;cursor:pointer}" +
    ".lang-menu button:hover,.lang-menu button:focus-visible{background:var(--mist,#E8F3F1);outline:none}" +
    ".lang-menu button[aria-selected=true]{font-weight:700;color:var(--lagoon-dark,#0A5F5E)}" +
    ".lang-menu button[aria-selected=true]::after{content:'\\2713'}" +
    "@media(max-width:760px){.lang-btn{min-height:42px;padding:0 10px}.lang-btn .lang-code{display:none}.lang-menu{position:fixed;left:12px;right:12px;top:68px;width:auto}}" +
    /* hide Google's own toolbar and tooltips */
    ".goog-te-banner-frame,.goog-te-balloon-frame,#goog-gt-tt,.goog-tooltip,.skiptranslate>iframe,.VIpgJd-ZVi9od-ORHb-OEVmcd,.VIpgJd-ZVi9od-aZ2wEe-wOHMyf{display:none!important}" +
    ".goog-text-highlight{background:none!important;box-shadow:none!important}body{top:0!important;position:static!important}#b5_gt{display:none}";
  document.head.appendChild(css);

  /* ---- keep brand names and the live demo from being translated ---- */
  function protect() {
    document.querySelectorAll(".logo, #chatMessages, #chatInput, #chatChips").forEach(function (e) { e.setAttribute("translate", "no"); e.classList.add("notranslate"); });
  }

  /* ---- build the button ---- */
  function build() {
    var wrap = document.createElement("div"); wrap.className = "lang notranslate"; wrap.setAttribute("translate", "no");
    var label = LANGS.filter(function (l) { return l[0] === current; })[0];
    var btn = document.createElement("button"); btn.type = "button"; btn.className = "lang-btn"; btn.id = "langBtn";
    btn.setAttribute("aria-haspopup", "listbox"); btn.setAttribute("aria-expanded", "false"); btn.setAttribute("aria-label", "Language: " + label[1]);
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 4 5.7 4 9s-1.4 6.4-4 9c-2.6-2.6-4-5.7-4-9s1.4-6.4 4-9z"/></svg><span class="lang-code">' + (SHORT[current] || current.toUpperCase()) + "</span>";
    var menu = document.createElement("ul"); menu.className = "lang-menu"; menu.id = "langMenu"; menu.hidden = true; menu.setAttribute("role", "listbox"); menu.setAttribute("aria-label", "Choose a language");
    LANGS.forEach(function (l) {
      var li = document.createElement("li"), b = document.createElement("button");
      b.type = "button"; b.setAttribute("role", "option"); b.setAttribute("aria-selected", l[0] === current ? "true" : "false"); b.setAttribute("lang", l[0] === "iw" ? "he" : l[0]); b.textContent = l[1]; b.dataset.code = l[0];
      b.onclick = function () { choose(l[0]); };
      li.appendChild(b); menu.appendChild(li);
    });
    wrap.appendChild(btn); wrap.appendChild(menu);

    function items() { return Array.prototype.slice.call(menu.querySelectorAll("button")); }
    function close(focusBtn) { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); if (focusBtn) btn.focus(); }
    function open() { menu.hidden = false; btn.setAttribute("aria-expanded", "true"); var sel = menu.querySelector("[aria-selected=true]") || menu.querySelector("button"); sel.focus(); sel.scrollIntoView({ block: "nearest" }); }
    btn.onclick = function () { menu.hidden ? open() : close(true); };
    menu.addEventListener("keydown", function (e) {
      var list = items(), i = list.indexOf(document.activeElement);
      if (e.key === "Escape") { e.preventDefault(); close(true); }
      else if (e.key === "ArrowDown") { e.preventDefault(); list[Math.min(list.length - 1, i + 1)].focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); list[Math.max(0, i - 1)].focus(); }
      else if (e.key === "Home") { e.preventDefault(); list[0].focus(); }
      else if (e.key === "End") { e.preventDefault(); list[list.length - 1].focus(); }
      else if (e.key === "Tab") close(false);
    });
    document.addEventListener("click", function (e) { if (!wrap.contains(e.target)) close(false); });

    var actions = document.querySelector(".nav-actions"), menuBtn = document.getElementById("menuBtn"), topLinks = document.querySelector(".topbar-links");
    if (actions && menuBtn) actions.insertBefore(wrap, menuBtn);
    else if (topLinks) topLinks.appendChild(wrap);
    else return;
  }

  function choose(code) {
    if (code === current) return;
    writeCookie(code);
    location.reload();
  }

  /* ---- load Google's translator only when a non-English language is active ---- */
  function loadTranslator() {
    var box = document.createElement("div"); box.id = "b5_gt"; box.setAttribute("aria-hidden", "true"); document.body.appendChild(box);
    window.b5TranslateInit = function () {
      try { new google.translate.TranslateElement({ pageLanguage: "en", autoDisplay: false }, "b5_gt"); } catch (e) { /* ignore */ }
    };
    var s = document.createElement("script"); s.async = true; s.src = "https://translate.google.com/translate_a/element.js?cb=b5TranslateInit"; document.head.appendChild(s);
  }

  function init() {
    protect(); build();
    document.documentElement.setAttribute("lang", current === "iw" ? "he" : current);
    if (current !== "en") loadTranslator();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
