# Onyx Paper Trading — Design & Build Contract

This file is the single source of truth for the build. Every implementation
decision is fixed here. If code and this file disagree, this file wins. Re-read
the relevant section before writing code for it.

---

## 0. What we're building

A deployed web app for paper-trading live prediction markets. Users sign up, get
a $1,000 paper balance, browse live markets from the Onyx Predictions API, and
place simulated market orders (buy YES / buy NO) that fill instantly at the
current upstream price. **Nothing executes against the upstream venue** — every
order, fill, and position is recorded only in our own database.

Stack: **Node + Express + TypeScript** (backend), **React + TypeScript (Vite)**
(frontend), **PostgreSQL** + Prisma, single-origin deploy (Express serves the
built client).

---

## 1. Non-negotiable invariants ("never" rules)

These are the rules an agent is most likely to violate because each looks locally
reasonable. They are prohibitions. Do not violate them to make a screen or a test
pass.

1. **Never store the 0–1 float.** Prices convert to integer cents at the system
   boundary (`toCents(p) = Math.round(p * 100)`). Every persisted monetary value
   is integer cents.
2. **Never store balance as a mutable field that you decrement.** Balance is
   derived from the append-only ledger (`SUM(delta_cents)`).
3. **Never treat `positions` as the source of truth.** Positions are a derived
   cache, rebuildable by folding the immutable fill log.
4. **Never fill outside bounds.** Every fill must satisfy
   `MIN_PRICE_CENTS < price_cents < MAX_PRICE_CENTS` (i.e. `1 < p < 99`) and be
   non-null, regardless of which source produced it. Reject — never silently
   clamp.
5. **Never call the upstream `POST /orders`.** That is the real order book. Paper
   trading means orders live only in our DB.
6. **Never store P&L as truth.** Unrealized P&L is computed on read from current
   cached price and position cost basis.
7. **Never let a client read hit Onyx directly.** All client price reads come
   from our server-side cache. Only the single fetcher talks to Onyx.
8. **Never use floats for money math.** Integer cents end to end.

---

## 2. Onyx Predictions API — confirmed facts (verified live)

Base URL: `https://predictions.dev-onyxodds.com`

### Auth (their system — we do NOT use it for our app)
- **No API key.** Market data is public; their trading/account data needs a JWT
  bearer token. We only ever call the public market-data endpoints, so **our
  server needs no Onyx credentials at all.**
- For reference only: `POST /api/auth/register` `{username, password}`;
  `POST /api/auth/login` → `{access_token, token_type:"bearer"}`;
  authed calls use `Authorization: Bearer <token>`. We do not use these.

### Market data (public, no auth)
- `GET /markets?limit=&offset=&sport=&status=open&event_type=&contract_type=&period_type=`
  → array of markets. The wire field for the market title is `name` (not `title`);
  `httpOnyxClient` maps `name` → `title` in the adapter so downstream code uses
  `title` uniformly. These query params back our search/filter UI directly.
- `GET /markets/{symbol}` → single market.
- `GET /markets/{symbol}/prices` → `{symbol, bid_price, ask_price, last_price, volume}`.

### Price units — CONFIRMED LIVE (0–1 dollars per share)
- `yes_price` / `bid_price` / `last_price` are **0–1 floats** = dollars per share.
  Bounds `min_price=0.01`, `max_price=0.99`.
- Observed distinct live values: `0.2, 0.5, 0.8`. Same symbol returned
  `last_price=0.5, bid_price=0.5`.
- Convention: a YES share costs `p` dollars, pays `$1` if it resolves YES; a NO
  share costs `1 - p`.
- Conversion at boundary: `toCents(p) = Math.round(p * 100)`. Starting balance
  $1,000 = `100000` cents. `MIN_PRICE_CENTS = 1`, `MAX_PRICE_CENTS = 99`.

### Field reliability — measured across 30 live symbols
- `last_price`: reliable. Non-null and in-bounds across all sampled symbols;
  agrees with `bid` in 28/30.
- `bid_price`: reliable. Zero null, zero out-of-bounds.
- `ask_price`: **intermittently crossed.** 28/30 sane; 1 symbol returned
  `ask=0.05` against `bid=0.5` (ask below bid). Per-symbol glitch, not systematic.
- One genuine wide spread observed (`bid=0.2, ask=0.8, last=0.5`) — real, not
  garbage; `last` is the right fill reference there.

### Upstream feed is intermittent
- Many markets currently return `null` prices; `/cache/prices` and
  `/api/debug/prices` time out. The dev feed is flaky. The app must degrade
  gracefully (see §5).

---

## 3. Data model (Postgres / Prisma)

Truth is an append-only ledger. Everything else is derived.

- **User** — `id`, `email` (unique), `passwordHash`, `createdAt`. No balance
  field. Balance is derived.
- **Order** — intent. `id`, `userId`, `requestId` (**unique**, idempotency),
  `marketSymbol`, `marketTitle`, `side` (YES|NO), `quantity`, `createdAt`.
  Immutable.
- **Fill** — what executed. `id`, `orderId` (unique), `userId`, `marketSymbol`,
  `side`, `priceCents`, `priceSource` (e.g. `last_price`), `quantity`,
  `createdAt`. **Immutable. Source of truth for positions.**
- **LedgerEntry** — `id`, `userId`, `deltaCents` (signed), `reason`
  (`SEED` | `BUY`), `refId`, `createdAt`. **Append-only.** Balance =
  `SUM(deltaCents)` for the user. On signup, write one `SEED` entry of
  `+100000`.
- **Position** — derived cache. `(userId, marketSymbol, side)` unique. `quantity`,
  `avgCostCents`, `updatedAt`. Rebuildable from `Fill`. Updated transactionally
  on each fill; never the authority.
- **MarketSnapshot** — price cache. `marketSymbol` (pk), `title`,
  `priceCents` (resolved), `priceSource`, `bidCents`, `lastCents`,
  `raw` (Json), `fetchedAt`. Written only by the fetcher.

---

## 4. Fill logic

### Price resolution (`resolvePrice`)
A pure function: `resolvePrice(raw, side) -> { cents, source } | null`.

Source order reflects measured reliability, not a single observation:
- **Buy YES** keys off `last_price` → `yes_price` (list) → `bid_price`.
  `last`/`yes` are the spine (mutually corroborating); `bid` is reliable but
  demoted because in a genuine wide spread `last` is the better reference than the
  resting bid. **`ask_price` is advisory only** (intermittently crossed) — never a
  fill source.
- **Buy NO** price = `100 - (chosen YES cents)`.

### Bounds guard — standing invariant (not a patch for the ask anomaly)
After resolution, the **final fill price for the traded side** (the YES cents for
a YES buy, the `100 - p` NO cents for a NO buy) must satisfy
`MIN_PRICE_CENTS < price < MAX_PRICE_CENTS` and be non-null. Guard the
post-inversion value for NO. Failures are rejected, not clamped. This is the
general defense against any bad upstream value — crossed asks, future null/OOB
regressions, stale cache — independent of the observed ask glitch.

### The fill transaction (the correctness core)
`placeOrder(userId, symbol, side, quantity, requestId)` runs in **one
serializable transaction**:
1. Idempotency: if an Order with this `requestId` exists, return its existing
   fill (do not double-charge).
2. Read the resolved price for `symbol`+`side` from the price cache **at execution
   time**; run the bounds guard. Reject on null/stale/guard-fail.
3. `costCents = priceCents * quantity`.
4. Derive balance = `SUM(ledger)`. Reject if `costCents > balance`.
5. Write `Order`, `Fill` (with `priceSource`), `LedgerEntry` (`BUY`,
   `-costCents`), and upsert `Position` (new avg cost). Commit.
6. Return the fill including the price actually struck and its source.

Buy-to-open only (matches required surface area). No sells in scope.

---

## 5. Prices: cache, polling, and the three states

### Server-side cache + single fetcher
One fetcher process polls Onyx and writes `MarketSnapshot`. All client reads hit
our cache, never Onyx. Per-symbol prices come from `GET /markets/{symbol}/prices`
(the list's `yes_price` is often null), so the fetcher fans out per active symbol
on a **3–5s interval**. This decouples constant upstream load from variable user
load — critical given the flaky dev feed. If `listMarkets` encounters an HTTP or
network error, the adapter returns an empty array instead of throwing — a flaky
cycle degrades to "no markets refreshed" rather than crashing boot via an
unhandled rejection.

### Live updates to the client
WebSocket is **not exposed** by this API. Clients poll our cached endpoint
(`GET /markets`, `GET /markets/:symbol`) every 3–5s. Defensible: prediction prices
move on a human timescale, the cache makes each read cheap, and we poll for P&L
regardless. No push transport is added.

### Three price states (the rule the fill path and UI key off)
- **Present (fresh, in-bounds):** tradeable. Fill normally.
- **Stale (in-bounds but older than `STALE_AFTER_MS`):** tradeable, flagged stale
  in UI; fills proceed (a human can't act on sub-3s freshness).
- **Null / out-of-bounds after fallback:** **not tradeable.** Market is
  browseable; Buy buttons disabled; order endpoint rejects with a clear
  "no live price for this market" message.

### P&L marking with missing prices
Unrealized P&L = `quantity * (markCents - avgCostCents)`. `markCents` is the
latest cached price for the position's side. If the market currently has no live
price, **mark against the last-known cached price and flag it stale.** Never treat
a null price as zero — that would show a position as a total loss. If no price was
ever cached, fall back to `avgCostCents` (P&L = 0, flagged).

---

## 6. Auth & deploy (single-origin)

- Email + password. `bcrypt` hashing. JWT in an **httpOnly, SameSite=Lax,
  first-party cookie** (not localStorage). Wired by hand from a clean Express
  init — not from an auth-bundled template.
- **Single-origin deploy:** Express serves the built React client *and* the API
  under one domain. This makes the cookie first-party and **eliminates CORS
  entirely** — no preflight, no `SameSite=None`, no cross-site cookie handling.
- The API is stateless and the price cache is in Postgres (`MarketSnapshot`), so
  the scale path — frontend on a CDN, API scaled horizontally, fetcher as one
  worker — is a deploy-config change, not a rewrite. Single-origin is a strict
  subset of that topology, chosen deliberately to minimize failure surface.

---

## 7. API surface (our server)

- `POST /auth/signup` `{email, password}` → sets cookie, seeds ledger +100000.
- `POST /auth/login` `{email, password}` → sets cookie.
- `POST /auth/logout` → clears cookie.
- `GET /auth/me` → current user + derived balance.
- `GET /markets?q=&status=&sport=&...` → cached snapshots (search/filter).
- `GET /markets/:symbol` → single cached snapshot.
- `POST /orders` `{symbol, side, quantity, requestId}` → places fill (auth).
- `GET /orders` → order history (auth).
- `GET /portfolio` → derived balance, positions with live mark + unrealized P&L,
  equity (auth).

---

## 8. Verification — smoke test (live, against real upstream)

The build's live-integration step is verified against the real API with these
(no key required; `BASE=https://predictions.dev-onyxodds.com`):

```bash
# markets are public — no auth needed for our fetcher
curl "$BASE/markets?status=open&limit=20"

# price for one symbol (substitute a real symbol from the list above)
curl "$BASE/markets/<symbol>/prices"
# -> {symbol, bid_price, ask_price, last_price, volume}
# expect: some symbols null (intermittent feed); last_price/bid reliable when present;
#         ask_price occasionally crossed (below bid) — confirms §2 reliability notes
```

Our own server is smoke-tested per build step (signup → login → browse → place
order → see position/P&L), with each step's pass condition defined in its prompt.

---

## 9. Out of scope (explicit)
Sells / realized P&L; limit orders; market resolution/settlement; Redis (Postgres
cache is sufficient at this scale); WebSocket push (not exposed upstream).
These are named in the README's "what I'd do next" rather than half-built.
