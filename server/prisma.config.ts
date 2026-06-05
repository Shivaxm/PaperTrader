import path from "node:path";
import { defineConfig } from "prisma/config";

try { process.loadEnvFile(); } catch {}

export default defineConfig({
  earlyAccess: true,
  schema: path.join(__dirname, "prisma", "schema.prisma"),
  datasource: {
    url: process.env["DATABASE_URL"] ?? "postgresql://user:pass@localhost:5432/onyxpaper",
  },
});
