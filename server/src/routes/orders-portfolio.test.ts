import { describe, it, expect, beforeEach, afterAll } from "vitest";
import http from "node:http";
import { prisma } from "../lib/db.js";
import { app } from "../index.js";
import { signToken, COOKIE_NAME } from "../lib/auth.js";

// --- Helpers ---

async function seedUser(email: string, seedCents = 100_000) {
  const user = await prisma.user.create({
    data: { email, passwordHash: "test-hash" },
  });
  await prisma.ledgerEntry.create({
    data: { userId: user.id, deltaCents: seedCents, reason: "SEED" },
  });
  return user;
}

async function seedSnapshot(
  symbol: string,
  title: string,
  priceCents: number | null,
  lastCents: number | null = priceCents,
  bidCents: number | null = priceCents
) {
  await prisma.marketSnapshot.create({
    data: {
      marketSymbol: symbol,
      title,
      priceCents,
      priceSource: priceCents !== null ? "last" : null,
      bidCents,
      lastCents,
      raw: {},
      fetchedAt: new Date(),
    },
  });
}

async function cleanDb() {
  await prisma.ledgerEntry.deleteMany();
  await prisma.fill.deleteMany();
  await prisma.position.deleteMany();
  await prisma.order.deleteMany();
  await prisma.user.deleteMany();
  await prisma.marketSnapshot.deleteMany();
}

function cookieHeader(userId: string): string {
  return `${COOKIE_NAME}=${signToken(userId)}`;
}

function httpRequest(
  server: http.Server,
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === "string") return reject(new Error("no addr"));
    const reqHeaders: Record<string, string> = { ...headers };
    if (body) reqHeaders["content-type"] = "application/json";
    const req = http.request(
      { hostname: "127.0.0.1", port: addr.port, path, method, headers: reqHeaders },
      (res) => {
        let data = "";
        res.on("data", (chunk: string) => (data += chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) })
        );
      }
    );
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function post(server: http.Server, path: string, body: unknown, userId?: string) {
  const headers: Record<string, string> = {};
  if (userId) headers["cookie"] = cookieHeader(userId);
  return httpRequest(server, "POST", path, body, headers);
}

function get(server: http.Server, path: string, userId?: string) {
  const headers: Record<string, string> = {};
  if (userId) headers["cookie"] = cookieHeader(userId);
  return httpRequest(server, "GET", path, undefined, headers);
}

beforeEach(async () => {
  await cleanDb();
});

afterAll(async () => {
  await cleanDb();
  await prisma.$disconnect();
});

// --- Test cases ---

describe("POST /orders + GET /orders + GET /portfolio", () => {
  // Case 1: Happy path
  it("place order happy path: buy 10 YES @ 50¢, verify portfolio and orders", async () => {
    const user = await seedUser("happy@test.com");
    await seedSnapshot("MKT-A", "Test Market A", 50);

    const server = app.listen(0);
    try {
      const res = await post(server, "/orders", {
        symbol: "MKT-A",
        side: "YES",
        quantity: 10,
        requestId: "req-happy-1",
      }, user.id);

      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body["priceCents"]).toBe(50);
      expect(body["costCents"]).toBe(500);
      expect(body["orderId"]).toBeDefined();

      // GET /portfolio — balance should be 100000 - 500 = 99500
      const portfolio = await get(server, "/portfolio", user.id);
      expect(portfolio.status).toBe(200);
      const pBody = portfolio.body as Record<string, unknown>;
      expect(pBody["balanceCents"]).toBe(99_500);
      const positions = pBody["positions"] as Array<Record<string, unknown>>;
      expect(positions).toHaveLength(1);
      expect(positions[0]["quantity"]).toBe(10);
      expect(positions[0]["avgCostCents"]).toBe(50);

      // GET /orders — should list the order
      const orders = await get(server, "/orders", user.id);
      expect(orders.status).toBe(200);
      const oBody = orders.body as { orders: Array<Record<string, unknown>> };
      expect(oBody.orders).toHaveLength(1);
      expect(oBody.orders[0]["priceCents"]).toBe(50);
      expect(oBody.orders[0]["costCents"]).toBe(500);
    } finally {
      server.close();
    }
  });

  // Case 2: Insufficient funds
  it("insufficient funds → 402, portfolio balance unchanged", async () => {
    const user = await seedUser("broke@test.com", 100); // only 100 cents
    await seedSnapshot("MKT-B", "Expensive Market", 50);

    const server = app.listen(0);
    try {
      const res = await post(server, "/orders", {
        symbol: "MKT-B",
        side: "YES",
        quantity: 10, // cost = 500 > 100
        requestId: "req-broke-1",
      }, user.id);

      expect(res.status).toBe(402);

      // Balance unchanged
      const portfolio = await get(server, "/portfolio", user.id);
      const pBody = portfolio.body as Record<string, unknown>;
      expect(pBody["balanceCents"]).toBe(100);
      expect((pBody["positions"] as unknown[]).length).toBe(0);
    } finally {
      server.close();
    }
  });

  // Case 3: No live price
  it("no live price → 409, nothing written", async () => {
    const user = await seedUser("noprice@test.com");
    await seedSnapshot("MKT-NULL", "Null Market", null, null, null);

    const server = app.listen(0);
    try {
      const res = await post(server, "/orders", {
        symbol: "MKT-NULL",
        side: "YES",
        quantity: 1,
        requestId: "req-noprice-1",
      }, user.id);

      expect(res.status).toBe(409);

      // No orders created
      const orders = await get(server, "/orders", user.id);
      const oBody = orders.body as { orders: unknown[] };
      expect(oBody.orders).toHaveLength(0);
    } finally {
      server.close();
    }
  });

  // Case 4: Idempotent retry over HTTP
  it("idempotent retry: POST twice with same requestId → both 200, one order", async () => {
    const user = await seedUser("idem@test.com");
    await seedSnapshot("MKT-IDEM", "Idem Market", 50);

    const server = app.listen(0);
    try {
      const orderBody = {
        symbol: "MKT-IDEM",
        side: "YES",
        quantity: 5,
        requestId: "req-idem-http-1",
      };

      const res1 = await post(server, "/orders", orderBody, user.id);
      const res2 = await post(server, "/orders", orderBody, user.id);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      const body1 = res1.body as Record<string, unknown>;
      const body2 = res2.body as Record<string, unknown>;
      expect(body2["orderId"]).toBe(body1["orderId"]);

      // GET /orders shows exactly one order
      const orders = await get(server, "/orders", user.id);
      const oBody = orders.body as { orders: unknown[] };
      expect(oBody.orders).toHaveLength(1);

      // Balance charged only once: 100000 - 250 = 99750
      const portfolio = await get(server, "/portfolio", user.id);
      const pBody = portfolio.body as Record<string, unknown>;
      expect(pBody["balanceCents"]).toBe(99_750);
    } finally {
      server.close();
    }
  });

  // Case 5: Auth required (no cookie)
  it("auth required: POST/GET with no cookie → 401", async () => {
    const server = app.listen(0);
    try {
      const postRes = await post(server, "/orders", {
        symbol: "X",
        side: "YES",
        quantity: 1,
        requestId: "r",
      }); // no cookie
      expect(postRes.status).toBe(401);

      const getOrders = await get(server, "/orders"); // no cookie
      expect(getOrders.status).toBe(401);

      const getPortfolio = await get(server, "/portfolio"); // no cookie
      expect(getPortfolio.status).toBe(401);
    } finally {
      server.close();
    }
  });

  // Case 6: P&L marks live
  it("P&L marks live: buy @ 40, snapshot moves to 60 → unrealizedPnlCents = qty*20", async () => {
    const user = await seedUser("pnl@test.com");
    await seedSnapshot("MKT-PNL", "PnL Market", 40);

    const server = app.listen(0);
    try {
      // Buy 10 YES @ 40
      await post(server, "/orders", {
        symbol: "MKT-PNL",
        side: "YES",
        quantity: 10,
        requestId: "req-pnl-1",
      }, user.id);

      // Update snapshot price to 60
      await prisma.marketSnapshot.update({
        where: { marketSymbol: "MKT-PNL" },
        data: { priceCents: 60, lastCents: 60, bidCents: 60, fetchedAt: new Date() },
      });

      const portfolio = await get(server, "/portfolio", user.id);
      const pBody = portfolio.body as Record<string, unknown>;
      const positions = pBody["positions"] as Array<Record<string, unknown>>;
      expect(positions).toHaveLength(1);
      expect(positions[0]["markCents"]).toBe(60);
      expect(positions[0]["stale"]).toBe(false);
      expect(positions[0]["unrealizedPnlCents"]).toBe(200); // 10 * (60 - 40)
    } finally {
      server.close();
    }
  });

  // Case 7: P&L null-mark — never treat null as 0
  it("P&L null-mark: snapshot goes null → marks against avgCost, stale:true, not a total loss", async () => {
    const user = await seedUser("nullmark@test.com");
    await seedSnapshot("MKT-GONE", "Gone Market", 40);

    const server = app.listen(0);
    try {
      // Buy 10 YES @ 40
      await post(server, "/orders", {
        symbol: "MKT-GONE",
        side: "YES",
        quantity: 10,
        requestId: "req-nullmark-1",
      }, user.id);

      // Snapshot price goes null (feed dropped)
      await prisma.marketSnapshot.update({
        where: { marketSymbol: "MKT-GONE" },
        data: { priceCents: null, priceSource: null, lastCents: null, bidCents: null, fetchedAt: new Date() },
      });

      const portfolio = await get(server, "/portfolio", user.id);
      const pBody = portfolio.body as Record<string, unknown>;
      const positions = pBody["positions"] as Array<Record<string, unknown>>;
      expect(positions).toHaveLength(1);
      expect(positions[0]["stale"]).toBe(true);
      // markCents should be avgCostCents (40), NOT 0
      expect(positions[0]["markCents"]).toBe(40);
      // P&L = 0, not a total loss (would be -400 if marked at 0)
      expect(positions[0]["unrealizedPnlCents"]).toBe(0);
      // marketValueCents = 10 * 40 = 400, not 0
      expect(positions[0]["marketValueCents"]).toBe(400);
    } finally {
      server.close();
    }
  });

  // Case 8: NO-side consistency
  it("NO-side: buy NO when YES=30 → struck at 70; YES moves to 20 → NO mark 80, PnL = qty*10", async () => {
    const user = await seedUser("noside@test.com");
    // YES price = 30 → NO fill price = 70
    await seedSnapshot("MKT-NO", "NO Market", 30);

    const server = app.listen(0);
    try {
      // Buy 10 NO (fill at 100-30 = 70)
      const res = await post(server, "/orders", {
        symbol: "MKT-NO",
        side: "NO",
        quantity: 10,
        requestId: "req-no-1",
      }, user.id);

      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body["priceCents"]).toBe(70); // 100 - 30

      // With YES still at 30, NO mark = 100 - 30 = 70 → P&L = 0
      let portfolio = await get(server, "/portfolio", user.id);
      let pBody = portfolio.body as Record<string, unknown>;
      let positions = pBody["positions"] as Array<Record<string, unknown>>;
      expect(positions).toHaveLength(1);
      expect(positions[0]["markCents"]).toBe(70);
      expect(positions[0]["unrealizedPnlCents"]).toBe(0);

      // YES moves to 20 → NO mark = 100 - 20 = 80 → P&L = 10 * (80 - 70) = 100
      await prisma.marketSnapshot.update({
        where: { marketSymbol: "MKT-NO" },
        data: { priceCents: 20, lastCents: 20, bidCents: 20, fetchedAt: new Date() },
      });

      portfolio = await get(server, "/portfolio", user.id);
      pBody = portfolio.body as Record<string, unknown>;
      positions = pBody["positions"] as Array<Record<string, unknown>>;
      expect(positions[0]["markCents"]).toBe(80); // 100 - 20
      expect(positions[0]["unrealizedPnlCents"]).toBe(100); // 10 * (80 - 70)
    } finally {
      server.close();
    }
  });
});
