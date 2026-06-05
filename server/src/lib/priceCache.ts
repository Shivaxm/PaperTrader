import { prisma } from "./db.js";
import type { RawPrice } from "./resolvePrice.js";

export interface SnapshotForFill {
  raw: RawPrice;
  title: string;
}

export async function getRawPriceForFill(
  symbol: string
): Promise<SnapshotForFill | null> {
  const snap = await prisma.marketSnapshot.findUnique({
    where: { marketSymbol: symbol },
  });
  if (!snap) return null;
  return {
    raw: {
      lastCents: snap.lastCents,
      bidCents: snap.bidCents,
      yesPriceCents: null,
      askCents: null,
    },
    title: snap.title,
  };
}
