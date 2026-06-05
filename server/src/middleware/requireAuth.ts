// TEMPORARY STUB — replaced by real auth in the auth task

import type { Request, Response, NextFunction } from "express";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const userId = req.headers["x-user-id"];
  if (typeof userId !== "string" || !userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  req.userId = userId;
  next();
}
