import { describe, it, expect, beforeEach, afterAll } from "vitest";
import http from "node:http";
import { prisma } from "../lib/db.js";
import { app } from "../index.js";

async function cleanSnapshots() {
  await prisma.marketSnapshot.deleteMany();
}

function request(
  server: http.Server,
  path: string
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === "string") return reject(new Error("no addr"));
    const req = http.get(`http://127.0.0.1:${addr.port}${path}`, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) })
      );
    });
    req.on("error", reject);
  });
}

beforeEach(async () => {
  await cleanSnapshots();
});

afterAll(async () => {
  await cleanSnapshots();
  await prisma.$disconnect();
});

describe("GET /markets", () => {
  // Case 6: Fresh priced row
  it("fresh priced row → state:fresh, tradeable:true", async () => {
    await prisma.marketSnapshot.create({
      data: {
        marketSymbol: "MKT-FRESH",
        title: "Fresh Market",
        priceCents: 50,
        priceSource: "last",
        bidCents: 50,
        lastCents: 50,
        raw: {},
        fetchedAt: new Date(), // just now = fresh
      },
    });

    const server = app.listen(0);
    try {
      const res = await request(server, "/markets");
      expect(res.status).toBe(200);
      const body = res.body as { markets: Array<Record<string, unknown>> };
      expect(body.markets).toHaveLength(1);
      expect(body.markets[0]["state"]).toBe("fresh");
      expect(body.markets[0]["tradeable"]).toBe(true);
      expect(body.markets[0]["priceCents"]).toBe(50);
    } finally {
      server.close();
    }
  });

  // Case 7: Old fetchedAt → stale
  it("old fetchedAt → state:stale, tradeable:true", async () => {
    const oldDate = new Date(Date.now() - 60_000); // 60s ago, well past STALE_AFTER_MS
    await prisma.marketSnapshot.create({
      data: {
        marketSymbol: "MKT-STALE",
        title: "Stale Market",
        priceCents: 30,
        priceSource: "last",
        bidCents: 30,
        lastCents: 30,
        raw: {},
        fetchedAt: oldDate,
      },
    });

    const server = app.listen(0);
    try {
      const res = await request(server, "/markets");
      expect(res.status).toBe(200);
      const body = res.body as { markets: Array<Record<string, unknown>> };
      expect(body.markets).toHaveLength(1);
      expect(body.markets[0]["state"]).toBe("stale");
      expect(body.markets[0]["tradeable"]).toBe(true);
    } finally {
      server.close();
    }
  });

  // Case 8: Null-price row → unpriced
  it("null-price row → state:unpriced, tradeable:false", async () => {
    await prisma.marketSnapshot.create({
      data: {
        marketSymbol: "MKT-UNPRICED",
        title: "Unpriced Market",
        priceCents: null,
        priceSource: null,
        bidCents: null,
        lastCents: null,
        raw: {},
        fetchedAt: new Date(),
      },
    });

    const server = app.listen(0);
    try {
      const res = await request(server, "/markets");
      expect(res.status).toBe(200);
      const body = res.body as { markets: Array<Record<string, unknown>> };
      expect(body.markets).toHaveLength(1);
      expect(body.markets[0]["state"]).toBe("unpriced");
      expect(body.markets[0]["tradeable"]).toBe(false);
      expect(body.markets[0]["priceCents"]).toBeNull();
    } finally {
      server.close();
    }
  });

  // Case 9: ?q= filters by title substring, case-insensitive
  it("?q= filters by title substring case-insensitively", async () => {
    await prisma.marketSnapshot.createMany({
      data: [
        {
          marketSymbol: "MKT-NBA",
          title: "NBA Finals Winner",
          priceCents: 50,
          priceSource: "last",
          raw: {},
          fetchedAt: new Date(),
        },
        {
          marketSymbol: "MKT-NFL",
          title: "NFL Superbowl MVP",
          priceCents: 40,
          priceSource: "last",
          raw: {},
          fetchedAt: new Date(),
        },
      ],
    });

    const server = app.listen(0);
    try {
      // Search for "nba" (lowercase) should find "NBA Finals Winner"
      const res = await request(server, "/markets?q=nba");
      expect(res.status).toBe(200);
      const body = res.body as { markets: Array<Record<string, unknown>> };
      expect(body.markets).toHaveLength(1);
      expect(body.markets[0]["symbol"]).toBe("MKT-NBA");
    } finally {
      server.close();
    }
  });
});

describe("GET /markets/:symbol", () => {
  it("returns single snapshot", async () => {
    await prisma.marketSnapshot.create({
      data: {
        marketSymbol: "MKT-SINGLE",
        title: "Single Market",
        priceCents: 70,
        priceSource: "last",
        raw: {},
        fetchedAt: new Date(),
      },
    });

    const server = app.listen(0);
    try {
      const res = await request(server, "/markets/MKT-SINGLE");
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body["symbol"]).toBe("MKT-SINGLE");
      expect(body["priceCents"]).toBe(70);
      expect(body["state"]).toBe("fresh");
    } finally {
      server.close();
    }
  });

  it("returns 404 for unknown symbol", async () => {
    const server = app.listen(0);
    try {
      const res = await request(server, "/markets/DOES-NOT-EXIST");
      expect(res.status).toBe(404);
    } finally {
      server.close();
    }
  });
});
