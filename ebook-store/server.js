import "dotenv/config";
import fs from "node:fs";
import express from "express";
import session from "express-session";
import Stripe from "stripe";
import { OAuth2Client } from "google-auth-library";

const {
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  BASE_URL = "http://localhost:4242",
  SESSION_SECRET = "change-me",
} = process.env;

// Managed Payments requires this preview API version (from the blueprint).
const MANAGED_PAYMENTS_API_VERSION = "2026-02-25.preview";
const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: MANAGED_PAYMENTS_API_VERSION,
});

const googleClient = new OAuth2Client(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  `${BASE_URL}/auth/google/callback`
);

// ---- Tiny JSON datastore (swap for a real database in production) ----
const DB_FILE = "data.json";
const loadDb = () =>
  fs.existsSync(DB_FILE)
    ? JSON.parse(fs.readFileSync(DB_FILE, "utf8"))
    : { users: {}, config: {} };
const saveDb = (db) => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));

// ---- Product setup: create the e-book product once and remember its price ----
async function ensureProductPrice() {
  const db = loadDb();
  if (db.config.priceId) return db.config.priceId;
  const product = await stripe.products.create({
    name: "Hamlet (e-book)",
    tax_code: "txcd_10103100",
    default_price_data: { currency: "usd", unit_amount: 1000 },
  });
  db.config.priceId = product.default_price;
  saveDb(db);
  return db.config.priceId;
}

const app = express();

// ---- Webhook (must receive the raw body, so register before express.json) ----
app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  (req, res) => {
    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        req.headers["stripe-signature"],
        STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      return res.status(400).send(`Webhook error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const checkoutSession = event.data.object;
      const db = loadDb();
      const user = Object.values(db.users).find(
        (u) => u.stripeCustomerId === checkoutSession.customer
      );
      if (user) {
        user.purchases = [...(user.purchases || []), checkoutSession.id];
        saveDb(db);
      }
    }
    res.json({ received: true });
  }
);

app.use(express.json());
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax" },
  })
);

const requireLogin = (req, res, next) =>
  req.session.userId ? next() : res.redirect("/");

// ---- Pages ----
app.get("/", (req, res) => {
  res.send(`<h1>Hamlet (e-book) – $10</h1>
    <p><a href="/auth/google">Sign in with Google</a></p>`);
});

app.get("/account", requireLogin, (req, res) => {
  const user = loadDb().users[req.session.userId];
  const purchased = (user.purchases || []).length > 0;
  res.send(`<h1>Account</h1>
    <p>Signed in as ${user.email}</p>
    <p>${purchased ? "You own this e-book." : "You haven't purchased yet."}</p>
    <form method="post" action="/create-checkout-session">
      <button>Buy Hamlet (e-book) – $10</button>
    </form>
    <h2>Billing options</h2>
    <form method="post" action="/create-billing-portal-session">
      <button>Manage billing</button>
    </form>
    <p><a href="/logout">Sign out</a></p>`);
});

app.get("/success", (req, res) =>
  res.send(`<h1>Thanks!</h1><p><a href="/account">Back to your account</a></p>`)
);

// ---- Google sign-in ----
app.get("/auth/google", (req, res) => {
  const url = googleClient.generateAuthUrl({
    scope: ["openid", "email", "profile"],
    prompt: "select_account",
  });
  res.redirect(url);
});

app.get("/auth/google/callback", async (req, res) => {
  try {
    const { tokens } = await googleClient.getToken(req.query.code);
    const ticket = await googleClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: GOOGLE_CLIENT_ID,
    });
    const { sub, email, name } = ticket.getPayload();

    const db = loadDb();
    db.users[sub] ||= { id: sub, email, name, purchases: [] };
    saveDb(db);

    req.session.userId = sub;
    res.redirect("/account");
  } catch (err) {
    console.error(err);
    res.status(400).send("Google sign-in failed.");
  }
});

app.get("/logout", (req, res) => req.session.destroy(() => res.redirect("/")));

// ---- Stripe: link each user to one Stripe customer ----
async function getOrCreateStripeCustomer(user) {
  if (user.stripeCustomerId) return user.stripeCustomerId;
  const customer = await stripe.customers.create({
    email: user.email,
    name: user.name,
    metadata: { app_user_id: user.id },
  });
  const db = loadDb();
  db.users[user.id].stripeCustomerId = customer.id;
  saveDb(db);
  return customer.id;
}

// ---- Stripe: Checkout with Managed Payments ----
app.post("/create-checkout-session", requireLogin, async (req, res) => {
  try {
    const user = loadDb().users[req.session.userId];
    const customerId = await getOrCreateStripeCustomer(user);
    const priceId = await ensureProductPrice();

    const checkoutSession = await stripe.checkout.sessions.create({
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      managed_payments: { enabled: true },
      mode: "payment",
      success_url: `${BASE_URL}/success`,
    });
    res.redirect(303, checkoutSession.url);
  } catch (err) {
    console.error(err);
    res.status(500).send(`Could not start checkout: ${err.message}`);
  }
});

// ---- Stripe: Billing portal ("Manage billing") ----
app.post("/create-billing-portal-session", requireLogin, async (req, res) => {
  try {
    const user = loadDb().users[req.session.userId];
    const customerId = await getOrCreateStripeCustomer(user);
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${BASE_URL}/account`,
    });
    res.redirect(303, portalSession.url);
  } catch (err) {
    console.error(err);
    res.status(500).send(`Could not open billing portal: ${err.message}`);
  }
});

const port = new URL(BASE_URL).port || 4242;
app.listen(port, () => console.log(`Running at ${BASE_URL}`));
