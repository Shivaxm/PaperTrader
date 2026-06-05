import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/requireAuth.js";
import { getRawPriceForFill } from "../lib/priceCache.js";
import {
  placeOrder,
  NoLivePriceError,
  InsufficientFundsError,
  InvalidOrderError,
} from "../lib/placeOrder.js";
import { prisma } from "../lib/db.js";

const router = Router();

const placeOrderSchema = z.object({
  symbol: z.string().min(1),
  side: z.enum(["YES", "NO"]),
  quantity: z.number().int().positive(),
  requestId: z.string().min(1),
});

// POST /orders
router.post("/", requireAuth, async (req, res) => {
  const parsed = placeOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const { symbol, side, quantity, requestId } = parsed.data;
  const userId = req.userId!;

  const snapshot = await getRawPriceForFill(symbol);
  if (!snapshot) {
    res.status(409).json({ error: "no live price for this market" });
    return;
  }

  try {
    const result = await placeOrder(
      { userId, symbol, marketTitle: snapshot.title, side, quantity, requestId },
      snapshot.raw
    );
    res.json(result);
  } catch (e) {
    if (e instanceof NoLivePriceError) {
      res.status(409).json({ error: e.message });
    } else if (e instanceof InsufficientFundsError) {
      res.status(402).json({ error: e.message });
    } else if (e instanceof InvalidOrderError) {
      res.status(400).json({ error: e.message });
    } else {
      throw e;
    }
  }
});

// GET /orders
router.get("/", requireAuth, async (req, res) => {
  const userId = req.userId!;

  const orders = await prisma.order.findMany({
    where: { userId },
    include: { fill: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  res.json({
    orders: orders.map((o) => ({
      id: o.id,
      marketSymbol: o.marketSymbol,
      marketTitle: o.marketTitle,
      side: o.side,
      quantity: o.quantity,
      priceCents: o.fill?.priceCents ?? null,
      priceSource: o.fill?.priceSource ?? null,
      costCents: o.fill ? o.fill.priceCents * o.fill.quantity : null,
      createdAt: o.createdAt.toISOString(),
    })),
  });
});

export default router;
