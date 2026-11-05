# E-book store: Google sign-in + Stripe Managed Payments

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill it in:
   - **Stripe keys:** Stripe Dashboard > Developers > API keys (use test keys first).
   - **Google keys:** Google Cloud Console > APIs & Services > Credentials > Create OAuth client ID (Web application).
     Add this authorized redirect URI: `http://localhost:4242/auth/google/callback`
3. Enable the customer portal: Stripe Dashboard > Settings > Billing > Customer portal.
   Your account must also be enrolled in Managed Payments.
4. Start the webhook forwarder (prints your `STRIPE_WEBHOOK_SECRET`, starts with `whsec_`):
   `stripe listen --forward-to localhost:4242/webhook`
5. `npm start` and open http://localhost:4242

## Flow

- `/auth/google` signs the user in and creates their account.
- `/create-checkout-session` creates a Stripe customer (saved to the user) and a Managed Payments Checkout Session ($10 Hamlet e-book).
- `/create-billing-portal-session` is the "Manage billing" button on the account page; it sends the signed-in user straight into their own portal, no login code needed.
- `/webhook` listens for `checkout.session.completed` and records the purchase.

## Test payment

Use card `4242 4242 4242 4242`, any future expiry, any CVC. Try different billing addresses to see tax change.

## Before going live

Replace `data.json` with a real database, set `cookie.secure: true` behind HTTPS, and use live keys and a production webhook endpoint.
