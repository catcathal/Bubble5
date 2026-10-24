# Bubble5

Landing page and live AI chatbot demo for Bubble5.

- `index.html` is the static site (GitHub Pages friendly).
- `worker/` is a Cloudflare Worker that answers the demo chat using Cloudflare AI Search over a sample knowledge base for a fictional bakery.

## Deploy the demo backend

1. Install dependencies and log in: `npx wrangler login`
2. Edit `worker/wrangler.toml`: set `ALLOWED_ORIGINS` to the site(s) that will host `index.html`.
3. Set a seeding secret: `cd worker && npx wrangler secret put ADMIN_TOKEN`
4. Deploy: `npx wrangler deploy`. Note the URL it prints.
5. Seed the knowledge base (creates the AI Search instance and uploads the sample docs):
   `curl -X POST https://<your-worker-url>/seed -H "X-Admin-Token: <your token>"`
6. In `index.html`, set `CHAT_API_URL` to `https://<your-worker-url>/chat`, commit and push.

To demo a prospect's own business, edit the documents in `worker/src/kb.js` (and the persona in `SYSTEM_PROMPT` in `worker/src/index.js`), redeploy and re-run the seed call.
