# Bubble5

Landing page and live AI chatbot demo for Bubble5.

- `index.html` is the static site (GitHub Pages friendly).
- `worker/` is a Cloudflare Worker that answers the demo chat using Cloudflare AI Search over a sample knowledge base for a fictional bakery.

## Deploy the demo backend

1. Install dependencies and log in: `npx wrangler login`
2. Edit `worker/wrangler.toml`: set `ALLOWED_ORIGINS` to the site(s) that will host `index.html`.
3. Create the leads database and table (stores early-access and contact form submissions):
   `npx wrangler d1 create bubble5-leads`, paste the printed `database_id` into `wrangler.toml`, then
   `npx wrangler d1 execute bubble5-leads --remote --file=schema.sql`
   Optional email alerts: set `NOTIFY_EMAIL` in `wrangler.toml` and run `npx wrangler secret put RESEND_API_KEY` (free Resend account).
   View leads any time: `npx wrangler d1 execute bubble5-leads --remote --command "SELECT * FROM leads ORDER BY id DESC"`
3b. Set a seeding secret: `cd worker && npx wrangler secret put ADMIN_TOKEN`
4. Deploy: `npx wrangler deploy`. Note the URL it prints.
5. The knowledge base seeds itself on the first chat (the first reply may say the demo is getting ready; try again after a minute or two). To re-seed manually after editing `kb.js`: `curl -X POST https://<your-worker-url>/seed -H "X-Admin-Token: <your token>"`
6. In `index.html`, set `CHAT_API_URL` to `https://<your-worker-url>/chat` and `LEAD_API_URL` to `https://<your-worker-url>/lead`, commit and push.

To demo a prospect's own business, edit the documents in `worker/src/kb.js` (and the persona in `SYSTEM_PROMPT` in `worker/src/index.js`), redeploy and re-run the seed call.

## Business portal, billing and help

- `app.html` is the customer portal: sign up and log in, knowledge base, billing and account settings. Accounts, sessions and documents live in the same D1 database (tables are in `worker/schema.sql`; run it again after pulling updates, it is safe to repeat).
- `help.html` is a public troubleshooting page with a guided diagnosis and live system check (`GET /health` on the Worker).
- Passwords are hashed with PBKDF2 and never stored in clear text. Login is rate limited.

### Switching on online billing (Stripe), the quick way
1. In Stripe, copy your secret key and add it to the Worker as the secret `STRIPE_SECRET_KEY`.
2. Sign in to the portal as the admin (the `NOTIFY_EMAIL` account), open Billing and press **Set up Stripe billing**. It creates the three plans (monthly and annual), the payment webhook and the customer billing portal, and saves the IDs in the database. Safe to press again.

Stripe Tax is optional. Turn it on in the Stripe dashboard (Tax, set your origin address and registrations), then add the Worker variable `STRIPE_TAX` = `on` **before** pressing the setup button, so prices are created tax-exclusive. Checkout then collects the billing address and an optional tax ID and adds tax automatically.

### Switching on online billing (Stripe), by hand
1. In Stripe, create products Starter, Pro (and Enterprise if you want) with a monthly and an annual recurring price.
2. Put the price IDs into `STRIPE_PRICES` in `worker/wrangler.toml` (see the comment there).
3. Add Worker secrets `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.
4. In Stripe, add a webhook to `https://<worker-url>/stripe-webhook` for `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted` and `invoice.payment_failed`.
5. In Stripe, turn on the Customer Portal (Settings, Billing, Customer portal) so customers can change plan, update cards and cancel.

Until these are set, the Billing page tells customers payments are being switched on and points them to the contact form.

### Website on your own domain
The Worker also serves the website, so attaching `bubble5.online` to the Worker as a custom domain (Workers and Pages, your Worker, Settings, Domains and Routes) is enough: no GitHub Pages or A records needed. `worker/build-site.mjs` copies the site files into `worker/public` on every deploy. Do not add a `CNAME` file to the repo unless the domain points at GitHub Pages: GitHub then redirects the github.io address to it.

## Customer chatbots, widget and inbox

- Each account gets its own chatbot (Portal, Your chatbot). Answers come from that account's knowledge base: the Worker finds the relevant passages in D1 (BM25 search, works for Thai too) and Workers AI (`[ai]` binding, Llama 3.3 70B) writes the reply. If the documents do not contain the answer it says so and offers the visitor a form; the lead is saved and emailed to the owner (needs `RESEND_API_KEY`).
- `assets/widget.js` is the embeddable chat bubble. Customers paste `<script src="https://<worker-url>/assets/widget.js" data-key="bk_..." defer></script>` into their site. Public endpoints: `GET /bot/:key/config`, `POST /bot/:key/chat`, `POST /bot/:key/lead`. Per-bot allowed domains, 10 messages a minute per visitor IP, monthly chat limits per plan (free trial = 50).
- Inbox shows conversations, unanswered questions and captured leads.
- Password reset by email needs `RESEND_API_KEY` (and a verified `FROM_EMAIL`). Without it the page tells people to contact you.
- Give someone a plan by hand (before Stripe is set up): `curl -X POST https://<worker-url>/admin/plan -H "X-Admin-Token: <ADMIN_TOKEN>" -H "Content-Type: application/json" -d '{"email":"them@example.com","plan":"starter"}'`
- After pulling, re-run `schema.sql` on the database (safe to repeat).

## Live chat (visitors talk to you)

- The "Chat with us" bubble is `assets/live.js` (included on `index.html` and `help.html`). Messages go to the same Worker and D1 database, no extra Worker needed.
- You reply from the portal: sign up at `app.html` using the same email as `NOTIFY_EMAIL` (or list emails in `ADMIN_EMAILS`) and a **Live chat** link appears in the header. You show as "online" for visitors while the portal is open in a browser tab.
- New visitor messages are emailed to `NOTIFY_EMAIL` (needs `RESEND_API_KEY`). If a visitor has left the site and gave an email, your reply is also emailed to them.
- Re-run `schema.sql` on the database after pulling (safe to repeat).

## AI support assistant and "Try it" sandbox

- The "Ask Bubble5" bubble answers with AI first (`POST /support/chat`, knowledge in `worker/src/supportkb.js`; edit that file to change what it knows). When it is unsure, or the visitor taps "Talk to a person", the conversation moves to live chat and the AI transcript is attached for you as a note.
- `POST /try/start` and `POST /try/:key/chat` let anyone paste business text and chat with it, no account. Sessions delete after a day and are rate limited per IP.
- The AI model is Workers AI Llama 3.3 70B. To switch models without code changes, set a text variable `AI_MODEL` (for example another `@cf/...` model from the Workers AI catalogue).
