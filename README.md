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

### Switching on online billing (Stripe)
1. In Stripe, create products Starter, Pro (and Enterprise if you want) with a monthly and an annual recurring price.
2. Put the price IDs into `STRIPE_PRICES` in `worker/wrangler.toml` (see the comment there).
3. Add Worker secrets `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.
4. In Stripe, add a webhook to `https://<worker-url>/stripe-webhook` for `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted` and `invoice.payment_failed`.
5. In Stripe, turn on the Customer Portal (Settings, Billing, Customer portal) so customers can change plan, update cards and cancel.

Until these are set, the Billing page tells customers payments are being switched on and points them to the contact form.
