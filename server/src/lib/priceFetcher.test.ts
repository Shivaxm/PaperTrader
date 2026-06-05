import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "./db.js";
import { refreshPrices } from "./priceFetcher.js";
import { mockOnyxClient, type MockFixtures } from "./onyxClient.js";

async function cleanSnapshots() {
  await prisma.marketSnapshot.deleteMany();
}

beforeEach(async () => {
  await cleanSnapshots();
});

afterAll(async () => {
  await cleanSnapshots();
  await prisma.$disconnect();
});

describe("refreshPrices", () => {
  // Case 1: Normal market with last_price=0.5
  it("normal market: last_price=0.5 → priceCents=50, priceSource=last", async () => {
    const fixtures: MockFixtures = {
      markets: [{ symbol: "MKT-NORMAL", title: "Normal Market" }],
      prices: {
        "MKT-NORMAL": {
          symbol: "MKT-NORMAL",
          bid_price: 0.5,
          ask_price: 0.6,
          last_price: 0.5,
          volume: 100,
        },
      },
    };

    await refreshPrices(mockOnyxClient(fixtures));

    const snap = await prisma.marketSnapshot.findUnique({
      where: { marketSymbol: "MKT-NORMAL" },
    });
    expect(snap).not.toBeNull();
    expect(snap!.priceCents).toBe(50);
    expect(snap!.priceSource).toBe("last");
    expect(snap!.bidCents).toBe(50);
    expect(snap!.lastCents).toBe(50);
    expect(snap!.title).toBe("Normal Market");
  });

  // Case 2: Crossed ask fixture (bid=0.5, ask=0.05, last=0.5) → resolved=50
  it("crossed ask: bid=0.5 ask=0.05 last=0.5 → priceCents=50 (ask ignored)", async () => {
    const fixtures: MockFixtures = {
      markets: [{ symbol: "MKT-CROSS", title: "Crossed Ask Market" }],
      prices: {
        "MKT-CROSS": {
          symbol: "MKT-CROSS",
          bid_price: 0.5,
          ask_price: 0.05,
          last_price: 0.5,
          volume: 50,
        },
      },
    };

    await refreshPrices(mockOnyxClient(fixtures));

    const snap = await prisma.marketSnapshot.findUnique({
      where: { marketSymbol: "MKT-CROSS" },
    });
    expect(snap).not.toBeNull();
    expect(snap!.priceCents).toBe(50);
    expect(snap!.priceSource).toBe("last");
    // Confirm ask=5 did NOT become the resolved price
    expect(snap!.priceCents).not.toBe(5);
  });

  // Case 3: Null price fixture → snapshot with priceCents=null
  it("null prices: all null → snapshot written with priceCents=null", async () => {
    const fixtures: MockFixtures = {
      markets: [{ symbol: "MKT-NULL", title: "Null Price Market" }],
      prices: {
        "MKT-NULL": {
          symbol: "MKT-NULL",
          bid_price: null,
          ask_price: null,
          last_price: null,
          volume: null,
        },
      },
    };

    await refreshPrices(mockOnyxClient(fixtures));

    const snap = await prisma.marketSnapshot.findUnique({
      where: { marketSymbol: "MKT-NULL" },
    });
    expect(snap).not.toBeNull();
    expect(snap!.priceCents).toBeNull();
    expect(snap!.priceSource).toBeNull();
    expect(snap!.title).toBe("Null Price Market");
  });

  // Case 4: One symbol throws → that symbol gets null-price, others still written
  it("one symbol throws: failing symbol gets null-price snapshot, others succeed", async () => {
    const fixtures: MockFixtures = {
      markets: [
        { symbol: "MKT-OK", title: "OK Market" },
        { symbol: "MKT-FAIL", title: "Fail Market" },
      ],
      prices: {
        "MKT-OK": {
          symbol: "MKT-OK",
          bid_price: 0.3,
          ask_price: 0.4,
          last_price: 0.3,
          volume: 10,
        },
        "MKT-FAIL": new Error("upstream timeout"),
      },
    };

    await refreshPrices(mockOnyxClient(fixtures));

    const okSnap = await prisma.marketSnapshot.findUnique({
      where: { marketSymbol: "MKT-OK" },
    });
    expect(okSnap).not.toBeNull();
    expect(okSnap!.priceCents).toBe(30);
    expect(okSnap!.priceSource).toBe("last");

    const failSnap = await prisma.marketSnapshot.findUnique({
      where: { marketSymbol: "MKT-FAIL" },
    });
    expect(failSnap).not.toBeNull();
    expect(failSnap!.priceCents).toBeNull();
    expect(failSnap!.priceSource).toBeNull();
    expect(failSnap!.title).toBe("Fail Market");
  });

  // Case 5: Re-running refreshPrices upserts (no duplicates) and advances fetchedAt
  it("re-run upserts existing rows and advances fetchedAt", async () => {
    const fixtures: MockFixtures = {
      markets: [{ symbol: "MKT-UPSERT", title: "Upsert Market" }],
      prices: {
        "MKT-UPSERT": {
          symbol: "MKT-UPSERT",
          bid_price: 0.4,
          ask_price: 0.5,
          last_price: 0.4,
          volume: 20,
        },
      },
    };

    await refreshPrices(mockOnyxClient(fixtures));

    const snap1 = await prisma.marketSnapshot.findUnique({
      where: { marketSymbol: "MKT-UPSERT" },
    });
    expect(snap1).not.toBeNull();
    const fetchedAt1 = snap1!.fetchedAt;

    // Small delay to ensure fetchedAt advances
    await new Promise((r) => setTimeout(r, 50));

    // Update the price fixture
    fixtures.prices["MKT-UPSERT"] = {
      symbol: "MKT-UPSERT",
      bid_price: 0.6,
      ask_price: 0.7,
      last_price: 0.6,
      volume: 30,
    };

    await refreshPrices(mockOnyxClient(fixtures));

    const snap2 = await prisma.marketSnapshot.findUnique({
      where: { marketSymbol: "MKT-UPSERT" },
    });
    expect(snap2).not.toBeNull();
    expect(snap2!.priceCents).toBe(60);
    expect(snap2!.fetchedAt.getTime()).toBeGreaterThan(fetchedAt1.getTime());

    // Only one row, not two
    const count = await prisma.marketSnapshot.count({
      where: { marketSymbol: "MKT-UPSERT" },
    });
    expect(count).toBe(1);
  });
});
