# Onyx Paper Trading

A paper-trading app for prediction markets: sign up, get a $1,000 paper balance,
browse live markets from the Onyx Predictions API, and place simulated buy
orders (YES or NO) that fill at the current price. Nothing hits the real venue —
every order, fill, balance, and position is tracked in this app's own database.

**Live app:** https://onyx-paper.onrender.com
**Repo:** https://github.com/Shivaxm/PaperTrader

> Note on the live site: the upstream Onyx **dev** feed is intermittent (it
> regularly returns 500s) and serves a small set of static placeholder prices
> (around 0.20 / 0.50 / 0.80) rather than live, moving prices. The app handles
> this gracefully — see "Working against a real, flaky API" below. A sparse
> market list or unchanging prices reflect the upstream feed, not an app
> failure. The free hosting tier also sleeps when idle, so the first request
> after a while may take ~30 seconds to wake.

---

## Running it locally

**You'll need:** Node 20+ and a PostgreSQL database. No API key — the Onyx
market endpoints are public.

The quickest way to get Postgres is Docker:

```bash
docker run --name onyxpg \
  -e POSTGRES_USER=user -e POSTGRES_PASSWORD=pass -e POSTGRES_DB=onyxpaper \
  -p 5432:5432 -d postgres:16
```

### Backend

```bash
cd server
cp .env.example .env        # then fill in the values below
npm install
npx prisma migrate dev      # creates the database tables
npm run dev                 # API on http://localhost:4000
```

`server/.env`:

```
DATABASE_URL="postgresql://user:pass@localhost:5432/onyxpaper"
JWT_SECRET="any-long-random-string"
ONYX_BASE_URL="https://predictions.dev-onyxodds.com"
PORT=4000
POLL_INTERVAL_MS=4000
STALE_AFTER_MS=60000
```

### Frontend

```bash
cd client
cp .env.example .env        # VITE_API_URL can stay empty (uses the dev proxy)
npm install
npm run dev                 # app on http://localhost:5173
```

Open http://localhost:5173 and sign up. In development the frontend proxies API
calls to the backend, so the login cookie works the same way it does in
production.

### Running it the way production does (single server)

In production, one server serves both the API and the built frontend:

```bash
# from the repo root
npm install
npm run build
cd server
NODE_ENV=production npm start   # everything on http://localhost:4000
```

---

## Major design decisions and trade-offs

### Money is never a number that gets edited in place

The most important decision was how to track balances. The obvious approach —
store a balance and add/subtract from it on each order — is also the easiest to
get subtly wrong, and once it's wrong you can't tell why.

Instead, the app keeps an **append-only ledger**. Every money movement (your
$1,000 starting credit, each purchase) is a new, permanent row. Your balance is
*calculated* by adding up the ledger, never stored as an editable field.
Positions work the same way — derived from a permanent record of every fill.

The payoff: every balance and position can be explained by replaying the
history, nothing silently drifts, and anything could be rebuilt from the fill
log if needed. The cost is a little more work on each read (adding up the
ledger), which is negligible at this scale and well worth the trustworthiness.
All money is stored as whole cents, never decimals, so there's no rounding
weirdness.

### Orders can't double-charge you

Placing an order does several things at once — check your balance, deduct the
cost, record the order and fill, update your position. These all happen inside a
**single database transaction**, so either all of it happens or none of it does.
You can't end up charged with no position recorded, and two orders racing each
other can't both spend the same dollar.

Each order also carries a unique ID, so a double-click or a retried request
still results in exactly one fill. (This is tested, including the double-click
case and a concurrent double-spend.)

### Live prices: one fetcher, shared cache, simple polling

A **single background process** fetches prices from Onyx on a timer and stores
the latest in the database. Every user reads from that shared cache — nobody's
browser calls Onyx directly. So upstream load stays constant no matter how many
people use the app, and the price you see is the same price your order fills
against, because they come from the same place.

For getting prices to the browser, the app simply **polls** every few seconds. I
considered pushing updates over a live connection (WebSocket/SSE), but
prediction prices move on a human timescale — a few seconds of delay is
invisible — and the app already polls to refresh profit/loss anyway. A live-push
connection would add complexity for no real benefit. (The upstream API doesn't
expose a price stream either, so polling its cache is the honest fit.)

### One app, one address

The frontend and backend are served from a **single web address** in production
(the backend serves the built frontend). This keeps the login cookie a normal,
secure first-party cookie — none of the cross-site cookie headaches you get when
frontend and backend live on different domains — and means there's just one
thing to deploy. Local dev mirrors this via a proxy, so login behaves
identically in both.

### Login

Email and password, with passwords hashed (bcrypt). The login token lives in a
secure, http-only cookie — not in browser storage — so it isn't exposed to
scripts. Built from scratch rather than from a starter kit.

### Working against a real, flaky API

The Onyx **dev** feed is genuinely unreliable: it intermittently returns 500s
and times out, and serves a small set of fixed placeholder prices rather than
live ones. Rather than fight this, I designed around it:

- **A failed price fetch never wipes good data.** If an update fails, the app
  keeps the last known price and marks it "stale" — it doesn't blank the market
  out. This stops the list from flickering every time the feed hiccups.
- **Three clear states.** A market is *live* (recent price, tradeable), *stale*
  (last-known price, still tradeable with a visible tag — a price that's a few
  seconds old is a fine reference for a paper fill), or *unpriced* (no price ever
  received — shown for completeness, but not tradeable).
- **Prices and P&L tell the truth.** Because the dev feed's prices rarely move,
  positions tend to be marked at the price you paid, so unrealized profit/loss
  often sits at $0. That's correct — no price movement means no gain or loss.
  Against a feed with real movement, equity and P&L would update continuously.

This felt more valuable than pretending the feed was solid: the app stays usable
and honest even when the upstream is having a bad day.

---

## What I'd do next with more time

- **Selling and realized profit/loss.** Right now you can only open positions
  (buy), which matches the required scope. The natural next step is closing
  positions and tracking realized gains — a second transaction path with its own
  careful testing.
- **Scale the price fetcher out.** It currently runs inside the single web
  server, which is correct for one instance. Because the cache already lives in
  the database, moving the fetcher to its own dedicated process would allow
  multiple web servers with no rewrite.
- **Smarter polling.** Back off automatically when the upstream is erroring, and
  poll fast-moving markets more often than quiet ones.
- **Richer account view.** Profit/loss over time, a portfolio value chart, and
  paginated order history.
- **More tests around the live edges.** The money logic is well-tested; I'd add
  end-to-end tests for the price-staleness and upstream-failure behavior.
