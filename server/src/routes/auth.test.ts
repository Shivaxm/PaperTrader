import { describe, it, expect, beforeEach, afterAll } from "vitest";
import http from "node:http";
import { prisma } from "../lib/db.js";
import { app } from "../index.js";
import { signToken, COOKIE_NAME } from "../lib/auth.js";

// --- Helpers ---

async function cleanDb() {
  await prisma.ledgerEntry.deleteMany();
  await prisma.fill.deleteMany();
  await prisma.position.deleteMany();
  await prisma.order.deleteMany();
  await prisma.user.deleteMany();
  await prisma.marketSnapshot.deleteMany();
}

function httpRequest(
  server: http.Server,
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>
): Promise<{ status: number; body: unknown; rawHeaders: string[] }> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === "string") return reject(new Error("no addr"));
    const reqHeaders: Record<string, string> = { ...headers };
    if (body) reqHeaders["content-type"] = "application/json";
    const req = http.request(
      { hostname: "127.0.0.1", port: addr.port, path, method, headers: reqHeaders },
      (res) => {
        let data = "";
        res.on("data", (chunk: string) => (data += chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            body: JSON.parse(data),
            rawHeaders: res.rawHeaders,
          })
        );
      }
    );
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function getSetCookieHeaders(rawHeaders: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < rawHeaders.length; i += 2) {
    if (rawHeaders[i]?.toLowerCase() === "set-cookie") {
      result.push(rawHeaders[i + 1]!);
    }
  }
  return result;
}

function extractCookie(rawHeaders: string[]): string | null {
  const cookies = getSetCookieHeaders(rawHeaders);
  for (const c of cookies) {
    if (c.startsWith(`${COOKIE_NAME}=`)) return c;
  }
  return null;
}

function extractCookieValue(rawHeaders: string[]): string | null {
  const cookie = extractCookie(rawHeaders);
  if (!cookie) return null;
  const val = cookie.split(";")[0]!.split("=").slice(1).join("=");
  return val || null;
}

beforeEach(async () => {
  await cleanDb();
});

afterAll(async () => {
  await cleanDb();
  await prisma.$disconnect();
});

describe("Auth", () => {
  // Case 1: Signup seeds balance
  it("signup seeds balance: 200, GET /auth/me shows balanceCents 100000, exactly one SEED entry", async () => {
    const server = app.listen(0);
    try {
      const res = await httpRequest(server, "POST", "/auth/signup", {
        email: "seed@test.com",
        password: "password123",
      });

      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body["id"]).toBeDefined();
      expect(body["email"]).toBe("seed@test.com");

      // Extract the cookie for subsequent requests
      const cookieVal = extractCookieValue(res.rawHeaders);
      expect(cookieVal).toBeTruthy();

      // GET /auth/me with the cookie
      const me = await httpRequest(server, "GET", "/auth/me", undefined, {
        cookie: `${COOKIE_NAME}=${cookieVal}`,
      });
      expect(me.status).toBe(200);
      const meBody = me.body as Record<string, unknown>;
      expect(meBody["balanceCents"]).toBe(100_000);

      // Assert exactly one SEED ledger entry
      const userId = body["id"] as string;
      const seeds = await prisma.ledgerEntry.findMany({
        where: { userId, reason: "SEED" },
      });
      expect(seeds).toHaveLength(1);
      expect(seeds[0]!.deltaCents).toBe(100_000);
    } finally {
      server.close();
    }
  });

  // Case 2: Signup atomicity — duplicate email creates neither User nor stray ledger
  it("signup atomicity: duplicate email creates neither User nor stray ledger entry", async () => {
    const server = app.listen(0);
    try {
      // First signup succeeds
      await httpRequest(server, "POST", "/auth/signup", {
        email: "dup@test.com",
        password: "password123",
      });

      const usersBefore = await prisma.user.count();
      const ledgerBefore = await prisma.ledgerEntry.count();

      // Second signup with same email fails
      const res = await httpRequest(server, "POST", "/auth/signup", {
        email: "dup@test.com",
        password: "password456",
      });
      expect(res.status).toBe(409);

      // No new User or LedgerEntry created
      expect(await prisma.user.count()).toBe(usersBefore);
      expect(await prisma.ledgerEntry.count()).toBe(ledgerBefore);
    } finally {
      server.close();
    }
  });

  // Case 3: Duplicate email → 409
  it("duplicate email: second signup → 409", async () => {
    const server = app.listen(0);
    try {
      const res1 = await httpRequest(server, "POST", "/auth/signup", {
        email: "same@test.com",
        password: "password123",
      });
      expect(res1.status).toBe(200);

      const res2 = await httpRequest(server, "POST", "/auth/signup", {
        email: "same@test.com",
        password: "password123",
      });
      expect(res2.status).toBe(409);
    } finally {
      server.close();
    }
  });

  // Case 4: Login
  it("login: correct creds → 200 + cookie; wrong password → 401; unknown email → 401", async () => {
    const server = app.listen(0);
    try {
      // Signup first
      await httpRequest(server, "POST", "/auth/signup", {
        email: "login@test.com",
        password: "password123",
      });

      // Correct login
      const good = await httpRequest(server, "POST", "/auth/login", {
        email: "login@test.com",
        password: "password123",
      });
      expect(good.status).toBe(200);
      expect(extractCookieValue(good.rawHeaders)).toBeTruthy();
      const goodBody = good.body as Record<string, unknown>;
      expect(goodBody["email"]).toBe("login@test.com");

      // Wrong password — generic 401
      const badPw = await httpRequest(server, "POST", "/auth/login", {
        email: "login@test.com",
        password: "wrongpassword",
      });
      expect(badPw.status).toBe(401);
      const badPwBody = badPw.body as Record<string, unknown>;
      expect(badPwBody["error"]).toBe("Invalid email or password");

      // Unknown email — same generic 401
      const badEmail = await httpRequest(server, "POST", "/auth/login", {
        email: "nobody@test.com",
        password: "password123",
      });
      expect(badEmail.status).toBe(401);
      const badEmailBody = badEmail.body as Record<string, unknown>;
      expect(badEmailBody["error"]).toBe("Invalid email or password");
    } finally {
      server.close();
    }
  });

  // Case 5: Cookie is httpOnly and token not in body
  it("cookie is httpOnly and token not in response body", async () => {
    const server = app.listen(0);
    try {
      const res = await httpRequest(server, "POST", "/auth/signup", {
        email: "cookie@test.com",
        password: "password123",
      });

      expect(res.status).toBe(200);

      // Set-Cookie header must have HttpOnly
      const setCookie = extractCookie(res.rawHeaders);
      expect(setCookie).toBeTruthy();
      expect(setCookie!.toLowerCase()).toContain("httponly");

      // Token must NOT appear in the response JSON body
      const bodyStr = JSON.stringify(res.body);
      const tokenVal = extractCookieValue(res.rawHeaders)!;
      expect(bodyStr).not.toContain(tokenVal);

      // Body should only have id and email, no token field
      const body = res.body as Record<string, unknown>;
      expect(body).not.toHaveProperty("token");
      expect(body).not.toHaveProperty("access_token");
    } finally {
      server.close();
    }
  });

  // Case 6: Protected routes use the cookie
  it("protected routes: valid cookie → 200; no cookie → 401; garbage cookie → 401", async () => {
    const server = app.listen(0);
    try {
      // Signup to get a valid cookie
      const signup = await httpRequest(server, "POST", "/auth/signup", {
        email: "protect@test.com",
        password: "password123",
      });
      const cookieVal = extractCookieValue(signup.rawHeaders)!;

      // Valid cookie → 200
      const good = await httpRequest(server, "GET", "/portfolio", undefined, {
        cookie: `${COOKIE_NAME}=${cookieVal}`,
      });
      expect(good.status).toBe(200);

      // No cookie → 401
      const noCookie = await httpRequest(server, "GET", "/portfolio");
      expect(noCookie.status).toBe(401);

      // Garbage cookie → 401
      const garbage = await httpRequest(server, "GET", "/portfolio", undefined, {
        cookie: `${COOKIE_NAME}=garbage.invalid.token`,
      });
      expect(garbage.status).toBe(401);
    } finally {
      server.close();
    }
  });

  // Case 7: End-to-end with real auth
  it("e2e: signup → POST /orders → GET /portfolio shows balance 99500", async () => {
    // Seed a priced market snapshot
    await prisma.marketSnapshot.create({
      data: {
        marketSymbol: "MKT-E2E",
        title: "E2E Market",
        priceCents: 50,
        priceSource: "last",
        bidCents: 50,
        lastCents: 50,
        raw: {},
        fetchedAt: new Date(),
      },
    });

    const server = app.listen(0);
    try {
      // Signup
      const signup = await httpRequest(server, "POST", "/auth/signup", {
        email: "e2e@test.com",
        password: "password123",
      });
      expect(signup.status).toBe(200);
      const cookieVal = extractCookieValue(signup.rawHeaders)!;
      const cookie = `${COOKIE_NAME}=${cookieVal}`;

      // POST /orders — buy 10 YES @ 50¢
      const order = await httpRequest(server, "POST", "/orders", {
        symbol: "MKT-E2E",
        side: "YES",
        quantity: 10,
        requestId: "req-e2e-1",
      }, { cookie });

      expect(order.status).toBe(200);
      const oBody = order.body as Record<string, unknown>;
      expect(oBody["priceCents"]).toBe(50);
      expect(oBody["costCents"]).toBe(500);

      // GET /portfolio — balance should be 100000 - 500 = 99500
      const portfolio = await httpRequest(server, "GET", "/portfolio", undefined, { cookie });
      expect(portfolio.status).toBe(200);
      const pBody = portfolio.body as Record<string, unknown>;
      expect(pBody["balanceCents"]).toBe(99_500);
    } finally {
      server.close();
    }
  });

  // Case 8: Stub is gone — x-user-id header no longer authenticates
  it("stub is gone: x-user-id with no cookie → 401", async () => {
    const server = app.listen(0);
    try {
      // Signup to create a real user
      const signup = await httpRequest(server, "POST", "/auth/signup", {
        email: "stubgone@test.com",
        password: "password123",
      });
      const userId = (signup.body as Record<string, unknown>)["id"] as string;

      // Try to access protected route with x-user-id header but NO cookie
      const res = await httpRequest(server, "GET", "/portfolio", undefined, {
        "x-user-id": userId,
      });
      expect(res.status).toBe(401);

      const ordersRes = await httpRequest(server, "GET", "/orders", undefined, {
        "x-user-id": userId,
      });
      expect(ordersRes.status).toBe(401);
    } finally {
      server.close();
    }
  });
});
