import { describe, it, expect } from "vitest";
import { app } from "./index.js";
import http from "node:http";

function request(
  server: http.Server,
  path: string
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === "string") return reject(new Error("no addr"));
    const req = http.get(`http://127.0.0.1:${addr.port}${path}`, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) })
      );
    });
    req.on("error", reject);
  });
}

describe("GET /health", () => {
  it("returns 200 and { ok: true }", async () => {
    const server = app.listen(0);
    try {
      const res = await request(server, "/health");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    } finally {
      server.close();
    }
  });
});
