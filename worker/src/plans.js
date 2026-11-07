// Plan limits. "none" is the free trial every new account starts on; paying customers get much more room.
//   chats            chats per month (null = unlimited)
//   docs             knowledge documents
//   docChars         characters in one document (longer text is split into parts automatically in the portal)
//   totalChars       characters across the whole knowledge base
//   urlImports       web pages that can be imported from a link per month
//   instructionChars length of the custom instructions the owner can write for the assistant
//   starters         tappable starter questions shown when the chat opens
//   faqs             quick question-and-answer pairs the owner can write straight into the settings
//   whiteLabel       can hide the "Powered by Bubble5" line
export const PLANS = {
  none: { name: "Free trial", chats: 50, docs: 10, docChars: 30000, totalChars: 150000, urlImports: 3, instructionChars: 600, starters: 3, faqs: 5, whiteLabel: false },
  starter: { name: "Starter", chats: 1000, docs: 50, docChars: 100000, totalChars: 1000000, urlImports: 30, instructionChars: 2000, starters: 4, faqs: 25, whiteLabel: false },
  pro: { name: "Pro", chats: 10000, docs: 250, docChars: 200000, totalChars: 3000000, urlImports: 150, instructionChars: 4000, starters: 6, faqs: 100, whiteLabel: true },
  enterprise: { name: "Enterprise", chats: null, docs: 1000, docChars: 300000, totalChars: 5000000, urlImports: 500, instructionChars: 8000, starters: 8, faqs: 300, whiteLabel: true },
};

export function planOf(user) {
  return PLANS[user && user.plan] || PLANS.none;
}

// What the portal needs to draw limits and meters. Keys must never clash with response fields such as `docs` (the list itself).
export function limitsOf(user) {
  const p = planOf(user);
  return {
    max_docs: p.docs, doc_chars: p.docChars, total_chars: p.totalChars, url_imports: p.urlImports,
    instruction_chars: p.instructionChars, starters: p.starters, faqs: p.faqs, white_label: p.whiteLabel,
  };
}
