// Plan limits. "none" is the free trial every new account starts on.
export const PLANS = {
  none: { name: "Free trial", chats: 50, docs: 5 },
  starter: { name: "Starter", chats: 1000, docs: 10 },
  pro: { name: "Pro", chats: 10000, docs: 50 },
  enterprise: { name: "Enterprise", chats: null, docs: 200 },
};
