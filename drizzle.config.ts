import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local", quiet: true });

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // drizzle-kit only needs this for push/migrate; `generate` works offline.
    url: process.env.DATABASE_URL ?? "postgres://localhost:5432/packroi",
  },
  strict: true,
  verbose: true,
});
