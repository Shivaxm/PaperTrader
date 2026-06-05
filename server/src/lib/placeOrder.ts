import { Prisma } from "@prisma/client";
import { prisma } from "./db.js";
import { resolvePrice, type RawPrice, type Side } from "./resolvePrice.js";

// --- Error classes ---

export class NoLivePriceError extends Error {
  constructor(symbol: string) {
    super(`No live price for market ${symbol}`);
    this.name = "NoLivePriceError";
  }
}

export class InsufficientFundsError extends Error {
  constructor(required: number, available: number) {
    super(`Insufficient funds: need ${required} cents, have ${available} cents`);
    this.name = "InsufficientFundsError";
  }
}

export class InvalidOrderError extends Error {
  constructor(reason: string) {
    super(`Invalid order: ${reason}`);
    this.name = "InvalidOrderError";
  }
}

// --- Types ---

export interface PlaceOrderArgs {
  userId: string;
  symbol: string;
  marketTitle: string;
  side: Side;
  quantity: number;
  requestId: string;
}

export interface PlaceOrderResult {
  orderId: string;
  fillId: string;
  priceCents: number;
  priceSource: string;
  costCents: number;
}

// --- Core fill transaction ---

export async function placeOrder(
  args: PlaceOrderArgs,
  raw: RawPrice
): Promise<PlaceOrderResult> {
  const { userId, symbol, marketTitle, side, quantity, requestId } = args;

  // Validate quantity upfront (before transaction)
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new InvalidOrderError("quantity must be a positive integer");
  }

  // Resolve price upfront (pure function, no DB needed)
  const resolved = resolvePrice(raw, side);
  if (!resolved) {
    throw new NoLivePriceError(symbol);
  }

  const { cents: priceCents, source: priceSource } = resolved;
  const costCents = priceCents * quantity;

  // Prisma side enum mapping
  const prismaSide = side === "YES" ? "YES" as const : "NO" as const;

  try {
    return await prisma.$transaction(
      async (tx) => {
        // 1. Idempotency: check if order with this requestId already exists
        const existingOrder = await tx.order.findUnique({
          where: { requestId },
          include: { fill: true },
        });

        if (existingOrder && existingOrder.fill) {
          return {
            orderId: existingOrder.id,
            fillId: existingOrder.fill.id,
            priceCents: existingOrder.fill.priceCents,
            priceSource: existingOrder.fill.priceSource,
            costCents: existingOrder.fill.priceCents * existingOrder.fill.quantity,
          };
        }

        // 2. Derive balance = SUM(ledger.deltaCents) for this user
        const balanceResult = await tx.ledgerEntry.aggregate({
          where: { userId },
          _sum: { deltaCents: true },
        });
        const balance = balanceResult._sum.deltaCents ?? 0;

        // 3. Reject if insufficient funds
        if (costCents > balance) {
          throw new InsufficientFundsError(costCents, balance);
        }

        // 4. Create Order
        const order = await tx.order.create({
          data: {
            userId,
            requestId,
            marketSymbol: symbol,
            marketTitle,
            side: prismaSide,
            quantity,
          },
        });

        // 5. Create Fill
        const fill = await tx.fill.create({
          data: {
            orderId: order.id,
            userId,
            marketSymbol: symbol,
            side: prismaSide,
            priceCents,
            priceSource,
            quantity,
          },
        });

        // 6. Create LedgerEntry (BUY, negative delta)
        await tx.ledgerEntry.create({
          data: {
            userId,
            deltaCents: -costCents,
            reason: "BUY",
            refId: order.id,
          },
        });

        // 7. Upsert Position with recomputed average cost
        const existing = await tx.position.findUnique({
          where: {
            userId_marketSymbol_side: {
              userId,
              marketSymbol: symbol,
              side: prismaSide,
            },
          },
        });

        if (existing) {
          const oldQty = existing.quantity;
          const oldTotal = existing.avgCostCents * oldQty;
          const newQty = oldQty + quantity;
          const newAvg = Math.round((oldTotal + costCents) / newQty);
          await tx.position.update({
            where: { id: existing.id },
            data: { quantity: newQty, avgCostCents: newAvg },
          });
        } else {
          await tx.position.create({
            data: {
              userId,
              marketSymbol: symbol,
              marketTitle,
              side: prismaSide,
              quantity,
              avgCostCents: priceCents,
            },
          });
        }

        return { orderId: order.id, fillId: fill.id, priceCents, priceSource, costCents };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (e) {
    // Handle unique constraint violation on requestId (race on idempotency)
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      const existingOrder = await prisma.order.findUnique({
        where: { requestId },
        include: { fill: true },
      });
      if (existingOrder && existingOrder.fill) {
        return {
          orderId: existingOrder.id,
          fillId: existingOrder.fill.id,
          priceCents: existingOrder.fill.priceCents,
          priceSource: existingOrder.fill.priceSource,
          costCents: existingOrder.fill.priceCents * existingOrder.fill.quantity,
        };
      }
    }
    throw e;
  }
}
