import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "./db.js";
import {
  placeOrder,
  NoLivePriceError,
  InsufficientFundsError,
} from "./placeOrder.js";
import type { RawPrice } from "./resolvePrice.js";

// Helper: create a user with a SEED ledger entry
async function seedUser(email: string, seedCents = 100_000) {
  const user = await prisma.user.create({
    data: { email, passwordHash: "test-hash" },
  });
  await prisma.ledgerEntry.create({
    data: { userId: user.id, deltaCents: seedCents, reason: "SEED" },
  });
  return user;
}

// Reset all tables between tests (order matters for FK constraints)
async function cleanDb() {
  await prisma.ledgerEntry.deleteMany();
  await prisma.fill.deleteMany();
  await prisma.position.deleteMany();
  await prisma.order.deleteMany();
  await prisma.user.deleteMany();
}

const goodRaw: RawPrice = {
  lastCents: 50,
  yesPriceCents: null,
  bidCents: null,
  askCents: null,
};

beforeEach(async () => {
  await cleanDb();
});

afterAll(async () => {
  await cleanDb();
  await prisma.$disconnect();
});

describe("placeOrder", () => {
  // Case 8: Happy path
  it("happy path: buy 10 YES @ 50¢", async () => {
    const user = await seedUser("happy@test.com");
    const result = await placeOrder(
      {
        userId: user.id,
        symbol: "MKT-1",
        marketTitle: "Test Market",
        side: "YES",
        quantity: 10,
        requestId: "req-happy-1",
      },
      goodRaw
    );

    expect(result.priceCents).toBe(50);
    expect(result.costCents).toBe(500);
    expect(result.priceSource).toBe("last");

    // Check balance = 100000 - 500 = 99500
    const bal = await prisma.ledgerEntry.aggregate({
      where: { userId: user.id },
      _sum: { deltaCents: true },
    });
    expect(bal._sum.deltaCents).toBe(99_500);

    // Check position
    const pos = await prisma.position.findFirst({
      where: { userId: user.id, marketSymbol: "MKT-1", side: "YES" },
    });
    expect(pos).not.toBeNull();
    expect(pos!.quantity).toBe(10);
    expect(pos!.avgCostCents).toBe(50);
  });

  // Case 9: Insufficient funds
  it("insufficient funds: rejects and writes nothing", async () => {
    const user = await seedUser("broke@test.com", 100); // only 100 cents

    const ordersBefore = await prisma.order.count();
    const fillsBefore = await prisma.fill.count();
    const ledgerBefore = await prisma.ledgerEntry.count();

    await expect(
      placeOrder(
        {
          userId: user.id,
          symbol: "MKT-1",
          marketTitle: "Test Market",
          side: "YES",
          quantity: 10,
          requestId: "req-broke-1",
        },
        goodRaw // 50 * 10 = 500 > 100
      )
    ).rejects.toThrow(InsufficientFundsError);

    // Nothing written
    expect(await prisma.order.count()).toBe(ordersBefore);
    expect(await prisma.fill.count()).toBe(fillsBefore);
    expect(await prisma.ledgerEntry.count()).toBe(ledgerBefore);
  });

  // Case 10: Idempotent retry
  it("idempotent retry: same requestId returns same result, no double charge", async () => {
    const user = await seedUser("idem@test.com");
    const args = {
      userId: user.id,
      symbol: "MKT-1",
      marketTitle: "Test Market",
      side: "YES" as const,
      quantity: 10,
      requestId: "req-idem-1",
    };

    const result1 = await placeOrder(args, goodRaw);
    const result2 = await placeOrder(args, goodRaw);

    expect(result2.orderId).toBe(result1.orderId);
    expect(result2.fillId).toBe(result1.fillId);

    // Exactly one fill and one BUY ledger entry
    const fills = await prisma.fill.count({ where: { userId: user.id } });
    expect(fills).toBe(1);

    const buyEntries = await prisma.ledgerEntry.count({
      where: { userId: user.id, reason: "BUY" },
    });
    expect(buyEntries).toBe(1);
  });

  // Case 11: No live price
  it("no live price: rejects with NoLivePriceError, nothing written", async () => {
    const user = await seedUser("noprice@test.com");
    const nullRaw: RawPrice = {
      lastCents: null,
      yesPriceCents: null,
      bidCents: null,
      askCents: null,
    };

    const ordersBefore = await prisma.order.count();

    await expect(
      placeOrder(
        {
          userId: user.id,
          symbol: "MKT-1",
          marketTitle: "Test Market",
          side: "YES",
          quantity: 1,
          requestId: "req-noprice-1",
        },
        nullRaw
      )
    ).rejects.toThrow(NoLivePriceError);

    expect(await prisma.order.count()).toBe(ordersBefore);
  });

  // Case 12: Average cost across two buys
  it("average cost: buy 10@40 then 10@60 → avgCost 50", async () => {
    const user = await seedUser("avg@test.com");

    const raw40: RawPrice = { lastCents: 40, yesPriceCents: null, bidCents: null, askCents: null };
    const raw60: RawPrice = { lastCents: 60, yesPriceCents: null, bidCents: null, askCents: null };

    await placeOrder(
      {
        userId: user.id,
        symbol: "MKT-AVG",
        marketTitle: "Avg Market",
        side: "YES",
        quantity: 10,
        requestId: "req-avg-1",
      },
      raw40
    );

    await placeOrder(
      {
        userId: user.id,
        symbol: "MKT-AVG",
        marketTitle: "Avg Market",
        side: "YES",
        quantity: 10,
        requestId: "req-avg-2",
      },
      raw60
    );

    const pos = await prisma.position.findFirst({
      where: { userId: user.id, marketSymbol: "MKT-AVG", side: "YES" },
    });
    expect(pos).not.toBeNull();
    expect(pos!.quantity).toBe(20);
    // (40*10 + 60*10) / 20 = 1000/20 = 50
    expect(pos!.avgCostCents).toBe(50);
  });

  // Case 13: Concurrency / double-spend
  it("concurrency: exactly one of two concurrent orders succeeds when funds allow only one", async () => {
    // Seed user with exactly 500 cents — enough for one order of 10@50
    const user = await seedUser("concurrent@test.com", 500);

    const makeArgs = (reqId: string) => ({
      userId: user.id,
      symbol: "MKT-RACE",
      marketTitle: "Race Market",
      side: "YES" as const,
      quantity: 10,
      requestId: reqId,
    });

    const results = await Promise.allSettled([
      placeOrder(makeArgs("req-race-1"), goodRaw),
      placeOrder(makeArgs("req-race-2"), goodRaw),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      InsufficientFundsError
    );

    // Final balance must never be negative
    const bal = await prisma.ledgerEntry.aggregate({
      where: { userId: user.id },
      _sum: { deltaCents: true },
    });
    expect(bal._sum.deltaCents).toBeGreaterThanOrEqual(0);

    // Exactly one fill
    const fillCount = await prisma.fill.count({ where: { userId: user.id } });
    expect(fillCount).toBe(1);
  });
});
