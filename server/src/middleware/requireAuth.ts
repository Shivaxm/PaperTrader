import type { Request, Response, NextFunction } from "express";
import { COOKIE_NAME } from "../lib/auth.js";
import { verifyToken } from "../lib/auth.js";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.[COOKIE_NAME];
  if (typeof token !== "string" || !token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const userId = verifyToken(token);
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  req.userId = userId;
  next();
}
