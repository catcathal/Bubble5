CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,            -- 'early_access' or 'contact'
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  company TEXT,
  message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  ip_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads (created_at);
CREATE INDEX IF NOT EXISTS idx_leads_ip ON leads (ip_hash, created_at);

-- Business accounts
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  company TEXT,
  pw_hash TEXT NOT NULL,
  pw_salt TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'none',          -- none | starter | pro | enterprise
  billing_interval TEXT,                      -- monthly | annual
  sub_status TEXT NOT NULL DEFAULT 'inactive',-- inactive | active | trialing | past_due | canceled ...
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  current_period_end TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users (stripe_customer_id);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);

CREATE TABLE IF NOT EXISTS kb_docs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_kb_user ON kb_docs (user_id);

CREATE TABLE IF NOT EXISTS usage (
  user_id INTEGER NOT NULL,
  month TEXT NOT NULL,                        -- e.g. 2026-10
  chats INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, month)
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,                          -- email or hashed IP
  kind TEXT NOT NULL,                         -- login | signup
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_attempts ON login_attempts (kind, key, created_at);

-- Per-business chatbot (one per account)
CREATE TABLE IF NOT EXISTS bots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  public_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT 'Assistant',
  business TEXT,
  greeting TEXT NOT NULL DEFAULT 'Hi! How can I help you today?',
  tone TEXT NOT NULL DEFAULT 'friendly',      -- friendly | professional | playful
  color TEXT NOT NULL DEFAULT '#6d4aff',
  allowed_domains TEXT NOT NULL DEFAULT '',   -- comma separated hostnames; empty = any site
  handoff_email TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bot_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id INTEGER NOT NULL,
  visitor TEXT NOT NULL,
  role TEXT NOT NULL,                         -- user | assistant
  content TEXT NOT NULL,
  unanswered INTEGER NOT NULL DEFAULT 0,
  ip_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_botmsg_bot ON bot_messages (bot_id, created_at);
CREATE INDEX IF NOT EXISTS idx_botmsg_ip ON bot_messages (ip_hash, created_at);

CREATE TABLE IF NOT EXISTS bot_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id INTEGER NOT NULL,
  name TEXT,
  email TEXT NOT NULL,
  message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_botleads_bot ON bot_leads (bot_id, created_at);
