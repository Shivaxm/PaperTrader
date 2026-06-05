import { Prisma } from "@prisma/client";
import { prisma } from "./db.js";
import { toCents } from "./toCents.js";
import { resolvePrice } from "./resolvePrice.js";
import type { OnyxClient } from "./onyxClient.js";

export const POLL_INTERVAL_MS = parseInt(
  process.env["POLL_INTERVAL_MS"] ?? "4000",
  10
);

export const STALE_AFTER_MS = parseInt(
  process.env["STALE_AFTER_MS"] ?? "60000",
  10
);

export async function refreshPrices(client: OnyxClient): Promise<void> {
  const markets = await client.listMarkets();

  await Promise.all(
    markets.map(async (market) => {
      try {
        const price = await client.getPrice(market.symbol);

        const lastCents = toCents(price.last_price);
        const bidCents = toCents(price.bid_price);
        const askCents = toCents(price.ask_price);
        const yesPriceCents = toCents(price.yes_price ?? null);

        const resolved = resolvePrice(
          { lastCents, bidCents, yesPriceCents, askCents },
          "YES"
        );

        await prisma.marketSnapshot.upsert({
          where: { marketSymbol: market.symbol },
          create: {
            marketSymbol: market.symbol,
            title: market.title,
            priceCents: resolved?.cents ?? null,
            priceSource: resolved?.source ?? null,
            bidCents,
            lastCents,
            raw: price as unknown as Prisma.InputJsonValue,
            fetchedAt: new Date(),
          },
          update: {
            title: market.title,
            priceCents: resolved?.cents ?? null,
            priceSource: resolved?.source ?? null,
            bidCents,
            lastCents,
            raw: price as unknown as Prisma.InputJsonValue,
            fetchedAt: new Date(),
          },
        });
      } catch {
        // Per-symbol failure: create a placeholder if the market is brand new,
        // but never overwrite an existing snapshot's price — let fetchedAt age
        // govern staleness so last-known prices survive transient upstream 500s.
        await prisma.marketSnapshot.upsert({
          where: { marketSymbol: market.symbol },
          create: {
            marketSymbol: market.symbol,
            title: market.title,
            priceCents: null,
            priceSource: null,
            bidCents: null,
            lastCents: null,
            raw: Prisma.JsonNull,
            fetchedAt: new Date(),
          },
          update: {
            title: market.title,
          },
        });
      }
    })
  );
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startFetcher(client: OnyxClient): void {
  void refreshPrices(client);
  intervalHandle = setInterval(() => void refreshPrices(client), POLL_INTERVAL_MS);
}

export function stopFetcher(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
