import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cookieParser from "cookie-parser";
import marketsRouter from "./routes/markets.js";
import ordersRouter from "./routes/orders.js";
import portfolioRouter from "./routes/portfolio.js";
import authRouter from "./routes/auth.js";
import { httpOnyxClient } from "./lib/onyxClient.js";
import { startFetcher } from "./lib/priceFetcher.js";

export const app = express();

app.use(express.json());
app.use(cookieParser());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/auth", authRouter);
app.use("/markets", marketsRouter);
app.use("/orders", ordersRouter);
app.use("/portfolio", portfolioRouter);

// In production, serve the built React client and add an SPA catch-all.
// API routes above take precedence; any other GET falls through to index.html.
if (process.env["NODE_ENV"] === "production") {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const clientDist = path.resolve(__dirname, "../../client/dist");
  app.use(express.static(clientDist));
  app.get("/{*splat}", (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

const PORT = parseInt(process.env["PORT"] ?? "4000", 10);

if (process.argv[1] === import.meta.filename) {
  const client = httpOnyxClient(
    process.env["ONYX_BASE_URL"] ?? "https://predictions.dev-onyxodds.com"
  );
  startFetcher(client);

  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}
