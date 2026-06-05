import express from "express";
import marketsRouter from "./routes/markets.js";
import { httpOnyxClient } from "./lib/onyxClient.js";
import { startFetcher } from "./lib/priceFetcher.js";

export const app = express();

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/markets", marketsRouter);

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
