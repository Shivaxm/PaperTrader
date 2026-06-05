import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { STALE_AFTER_MS } from "../lib/priceFetcher.js";

const router = Router();

type PriceState = "fresh" | "stale" | "unpriced";

function computeState(
  priceCents: number | null,
  fetchedAt: Date
): PriceState {
  if (priceCents === null) return "unpriced";
  const age = Date.now() - fetchedAt.getTime();
  return age > STALE_AFTER_MS ? "stale" : "fresh";
}

function formatSnapshot(snap: {
  marketSymbol: string;
  title: string;
  priceCents: number | null;
  priceSource: string | null;
  fetchedAt: Date;
}) {
  const state = computeState(snap.priceCents, snap.fetchedAt);
  return {
    symbol: snap.marketSymbol,
    title: snap.title,
    priceCents: snap.priceCents,
    priceSource: snap.priceSource,
    state,
    fetchedAt: snap.fetchedAt.toISOString(),
    tradeable: state !== "unpriced",
  };
}

// GET /markets
router.get("/", async (req, res) => {
  const q = typeof req.query["q"] === "string" ? req.query["q"] : undefined;

  const where: Prisma.MarketSnapshotWhereInput = {};
  if (q) {
    where.title = { contains: q, mode: "insensitive" };
  }

  const snapshots = await prisma.marketSnapshot.findMany({ where });
  res.json({ markets: snapshots.map(formatSnapshot) });
});

// GET /markets/:symbol
router.get("/:symbol", async (req, res) => {
  const snap = await prisma.marketSnapshot.findUnique({
    where: { marketSymbol: req.params["symbol"] },
  });
  if (!snap) {
    res.status(404).json({ error: "Market not found" });
    return;
  }
  res.json(formatSnapshot(snap));
});

export default router;
