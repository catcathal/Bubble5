// Everything an owner can customise about their chatbot, beyond the basic name, colour and greeting.
// Stored as one JSON text column (bots.settings). Pure functions only, so they are easy to test.

export const TONES = {
  friendly: "warm, friendly and concise",
  professional: "polite, professional and precise",
  playful: "upbeat, playful and concise (a light touch of humour is fine, never at the customer's expense)",
  concise: "brief, direct and to the point, with no filler",
  empathetic: "caring, patient and reassuring, quick to acknowledge how the visitor feels",
  refined: "polished, understated and gracious, like a concierge at a high-end business",
  expert: "knowledgeable and confident, explaining things clearly without jargon",
};
export const TONE_LABELS = {
  friendly: "Friendly", professional: "Professional", playful: "Playful", concise: "Concise",
  empathetic: "Empathetic", refined: "Refined", expert: "Expert",
};

export const LENGTHS = {
  short: { label: "Short", rule: "Keep every answer to 1 or 2 short sentences.", tokens: 260 },
  balanced: { label: "Balanced", rule: "Lead with the answer in the first few words, then add one useful extra detail. 1 to 3 short sentences.", tokens: 400 },
  detailed: { label: "Detailed", rule: "Give a complete answer in a short paragraph of up to 6 sentences. Use a short list when you are naming several things.", tokens: 700 },
};

export const EMOJI = { none: "Do not use emoji.", some: "At most one emoji, and only when it fits.", often: "Use a friendly emoji now and then." };

export const LANGUAGES = [
  "English", "Thai", "Spanish", "French", "German", "Italian", "Portuguese", "Dutch", "Polish", "Turkish", "Russian", "Ukrainian",
  "Arabic", "Hebrew", "Hindi", "Indonesian", "Malay", "Vietnamese", "Filipino", "Japanese", "Korean", "Chinese (Simplified)", "Chinese (Traditional)",
];

export const DEFAULT_STARTERS = ["What are your opening hours?", "How much does it cost?", "Where are you based?", "I'd like to book"];

export const DEFAULTS = {
  instructions: "",        // extra rules written by the owner
  length: "balanced",
  emoji: "some",
  language: "auto",        // auto = reply in the visitor's language
  fallback: "",            // what to say when the bot does not know ("" = built-in friendly handoff)
  show_starters: true,
  starters: [],            // [] = built-in generic starters
  faqs: [],                // [{ q, a }]
  position: "right",       // right | left
  theme: "light",          // light | dark
  avatar: "",              // an emoji or up to 2 characters; "" = first letter of the name
  launcher: "icon",        // icon | label
  launcher_label: "Chat with us",
  teaser: "default",       // default | off | custom
  teaser_text: "",
  placeholder: "",
  subtitle: "",
  hide_branding: false,    // plans with whiteLabel only
};

const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);
const text = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);
const line = (v, max) => text(v, max).replace(/\s*\n\s*/g, " ");

export function parseSettings(bot) {
  let raw = {};
  try { raw = bot && bot.settings ? JSON.parse(bot.settings) : {}; } catch { raw = {}; }
  return sanitizeSettings(raw, null, DEFAULTS);
}

// Cleans whatever the browser sent. `plan` (from plans.js) caps lengths and counts; pass null to skip plan caps.
// `base` supplies values the request leaves out.
export function sanitizeSettings(input, plan, base) {
  const b = input && typeof input === "object" ? input : {};
  const d = { ...DEFAULTS, ...(base || {}) };
  const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
  const instructionMax = plan ? plan.instructionChars : 8000;
  const starterMax = plan ? plan.starters : 8;
  const faqMax = plan ? plan.faqs : 300;

  const out = {
    instructions: has("instructions") ? text(b.instructions, instructionMax) : text(d.instructions, instructionMax),
    length: pick(has("length") ? b.length : d.length, Object.keys(LENGTHS), "balanced"),
    emoji: pick(has("emoji") ? b.emoji : d.emoji, Object.keys(EMOJI), "some"),
    language: has("language") ? (b.language === "auto" || LANGUAGES.includes(b.language) ? b.language : "auto") : d.language,
    fallback: has("fallback") ? text(b.fallback, 300) : text(d.fallback, 300),
    show_starters: has("show_starters") ? b.show_starters !== false : d.show_starters !== false,
    position: pick(has("position") ? b.position : d.position, ["right", "left"], "right"),
    theme: pick(has("theme") ? b.theme : d.theme, ["light", "dark"], "light"),
    avatar: has("avatar") ? Array.from(text(b.avatar, 12)).slice(0, 2).join("") : Array.from(text(d.avatar, 12)).slice(0, 2).join(""),
    launcher: pick(has("launcher") ? b.launcher : d.launcher, ["icon", "label"], "icon"),
    launcher_label: has("launcher_label") ? line(b.launcher_label, 24) || DEFAULTS.launcher_label : line(d.launcher_label, 24) || DEFAULTS.launcher_label,
    teaser: pick(has("teaser") ? b.teaser : d.teaser, ["default", "off", "custom"], "default"),
    teaser_text: has("teaser_text") ? line(b.teaser_text, 90) : line(d.teaser_text, 90),
    placeholder: has("placeholder") ? line(b.placeholder, 50) : line(d.placeholder, 50),
    subtitle: has("subtitle") ? line(b.subtitle, 50) : line(d.subtitle, 50),
    hide_branding: has("hide_branding") ? b.hide_branding === true : d.hide_branding === true,
  };

  const starters = has("starters") ? b.starters : d.starters;
  out.starters = (Array.isArray(starters) ? starters : []).map((s) => line(s, 60)).filter(Boolean).slice(0, starterMax);

  const faqs = has("faqs") ? b.faqs : d.faqs;
  out.faqs = (Array.isArray(faqs) ? faqs : [])
    .map((f) => ({ q: line(f && f.q, 200), a: text(f && f.a, 1200) }))
    .filter((f) => f.q && f.a)
    .slice(0, faqMax);

  if (plan && !plan.whiteLabel) out.hide_branding = false;
  return out;
}

// What actually applies right now: saved settings, held to the owner's current plan (for example after a downgrade).
export function effectiveSettings(bot, plan) {
  let raw = {};
  try { raw = bot && bot.settings ? JSON.parse(bot.settings) : {}; } catch { raw = {}; }
  return sanitizeSettings(raw, plan, DEFAULTS);
}

// The owner's quick Q&A pairs, turned into a document the chatbot can search like any other.
export function faqDoc(settings) {
  const faqs = (settings && settings.faqs) || [];
  if (!faqs.length) return null;
  return { title: "Quick answers", content: faqs.map((f) => `Q: ${f.q}\nA: ${f.a}`).join("\n\n") };
}

// Lines added to the system prompt for the owner's style choices.
export function styleRules(settings) {
  const s = settings || DEFAULTS;
  const len = LENGTHS[s.length] || LENGTHS.balanced;
  const lines = [len.rule, EMOJI[s.emoji] || EMOJI.some];
  lines.push(s.language && s.language !== "auto"
    ? `Always reply in ${s.language}, even when the visitor writes in another language.`
    : "Reply in the language the visitor writes in.");
  return lines;
}

// Fallback message(s) the chatbot uses when it does not know. Returns an array so the "did the visitor answer our offer?" check can match it.
export function handoffLines(settings, builtIn) {
  return settings && settings.fallback ? [settings.fallback] : builtIn;
}
