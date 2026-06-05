import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/db.js";
import {
  hashPassword,
  verifyPassword,
  signToken,
  COOKIE_NAME,
  COOKIE_OPTIONS,
} from "../lib/auth.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// POST /auth/signup
router.post("/signup", async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const { email, password } = parsed.data;
  const passwordHash = await hashPassword(password);

  try {
    const user = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: { email, passwordHash },
      });
      await tx.ledgerEntry.create({
        data: { userId: u.id, deltaCents: 100_000, reason: "SEED", refId: u.id },
      });
      return u;
    });

    const token = signToken(user.id);
    res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);
    res.json({ id: user.id, email: user.email });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      res.status(409).json({ error: "Email already in use" });
      return;
    }
    throw e;
  }
});

// POST /auth/login
router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const token = signToken(user.id);
  res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);
  res.json({ id: user.id, email: user.email });
});

// POST /auth/logout
router.post("/logout", (_req, res) => {
  res.clearCookie(COOKIE_NAME, { path: "/" });
  res.json({ ok: true });
});

// GET /auth/me
router.get("/me", requireAuth, async (req, res) => {
  const userId = req.userId!;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  const balanceResult = await prisma.ledgerEntry.aggregate({
    where: { userId },
    _sum: { deltaCents: true },
  });
  const balanceCents = balanceResult._sum.deltaCents ?? 0;

  res.json({ id: user.id, email: user.email, balanceCents });
});

export default router;
