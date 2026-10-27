// Finds the parts of a business's knowledge base that are relevant to a question.
// Small, dependency-free BM25 ranking. Works for spaced languages (English) and for Thai,
// which has no spaces between words, by matching overlapping 3-character pieces.

const STOP = new Set(
  ("a an and are as at be but by can do does did for from had has have how i if in is it its me my of on or our so than that the their them then there these they this to us was we were what when where which who why will with would you your yours " +
    "hi hello hey thanks thank please ok okay yes no not any some about get got just").split(" ")
);
const THAI = /\p{Script=Thai}/u;

function stem(w) {
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith("es")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

export function tokenize(text) {
  const out = [];
  const words = String(text || "").toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) || [];
  for (const w of words) {
    if (THAI.test(w)) {
      if (w.length <= 3) out.push(w);
      else for (let i = 0; i <= w.length - 3; i++) out.push(w.slice(i, i + 3));
    } else if (w.length >= 2 && !STOP.has(w)) {
      out.push(stem(w));
    }
  }
  return out;
}

// Splits documents into passages of roughly 800 characters.
export function chunkDocs(docs) {
  const chunks = [];
  const MAX = 800;
  for (const d of docs) {
    const paragraphs = String(d.content || "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    let buf = "";
    const flush = () => {
      if (buf.trim()) chunks.push({ title: d.title, text: buf.trim() });
      buf = "";
    };
    for (const p of paragraphs) {
      if (p.length > MAX * 1.25) {
        flush();
        for (let i = 0; i < p.length; i += MAX - 100) chunks.push({ title: d.title, text: p.slice(i, i + MAX).trim() });
      } else if ((buf + "\n\n" + p).length > MAX) {
        flush();
        buf = p;
      } else {
        buf = buf ? buf + "\n\n" + p : p;
      }
    }
    flush();
  }
  return chunks;
}

// Returns up to k chunks ordered by relevance, only those that share at least one term with the question.
export function rank(queryText, chunks, k = 6) {
  const q = [...new Set(tokenize(queryText))];
  if (!q.length || !chunks.length) return [];
  const docs = chunks.map((c) => {
    const toks = tokenize(c.title + " " + c.text);
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    return { c, tf, len: toks.length || 1 };
  });
  const avg = docs.reduce((s, d) => s + d.len, 0) / docs.length;
  const N = docs.length;
  const k1 = 1.4, b = 0.75;
  const scored = docs.map((d) => {
    let score = 0;
    for (const t of q) {
      const f = d.tf.get(t) || 0;
      if (!f) continue;
      let df = 0;
      for (const o of docs) if (o.tf.has(t)) df++;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / avg)));
    }
    return { chunk: d.c, score };
  });
  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, k).map((s) => s.chunk);
}
