import express from "express";

export const app = express();

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

const PORT = parseInt(process.env["PORT"] ?? "4000", 10);

if (process.argv[1] === import.meta.filename) {
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}
