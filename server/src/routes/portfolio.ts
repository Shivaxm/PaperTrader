import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { prisma } from "../lib/db.js";

const router = Router();

// GET /portfolio
router.get("/", requireAuth, async (req, res) => {
  const userId = req.userId!;

  // Derived balance = SUM(ledger.deltaCents) — invariant #2
  const balanceResult = await prisma.ledgerEntry.aggregate({
    where: { userId },
    _sum: { deltaCents: true },
  });
  const balanceCents = balanceResult._sum.deltaCents ?? 0;

  // Positions with quantity > 0
  const positions = await prisma.position.findMany({
    where: { userId, quantity: { gt: 0 } },
  });

  // Batch-fetch all relevant snapshots
  const symbols = [...new Set(positions.map((p) => p.marketSymbol))];
  const snapshots = await prisma.marketSnapshot.findMany({
    where: { marketSymbol: { in: symbols } },
  });
  const snapMap = new Map(snapshots.map((s) => [s.marketSymbol, s]));

  let totalPositionValueCents = 0;
  let totalUnrealizedPnlCents = 0;

  const positionResults = positions.map((pos) => {
    const snap = snapMap.get(pos.marketSymbol);
    let markCents: number;
    let stale: boolean;

    if (snap && snap.priceCents !== null) {
      // Live price available — mark at current price for this side
      if (pos.side === "YES") {
        markCents = snap.priceCents;
      } else {
        markCents = 100 - snap.priceCents;
      }
      stale = false;
    } else {
      // No live price — fall back to avgCostCents (P&L = 0), flag stale (§5)
      // Never treat null as 0 — that would show a total loss
      markCents = pos.avgCostCents;
      stale = true;
    }

    const costBasisCents = pos.quantity * pos.avgCostCents;
    const marketValueCents = pos.quantity * markCents;
    const unrealizedPnlCents = pos.quantity * (markCents - pos.avgCostCents);

    totalPositionValueCents += marketValueCents;
    totalUnrealizedPnlCents += unrealizedPnlCents;

    return {
      symbol: pos.marketSymbol,
      marketTitle: pos.marketTitle,
      side: pos.side,
      quantity: pos.quantity,
      avgCostCents: pos.avgCostCents,
      markCents,
      stale,
      costBasisCents,
      marketValueCents,
      unrealizedPnlCents,
    };
  });

  res.json({
    balanceCents,
    positions: positionResults,
    totalPositionValueCents,
    totalUnrealizedPnlCents,
    equityCents: balanceCents + totalPositionValueCents,
  });
});

export default router;
