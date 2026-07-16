import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { getEnv } from "@/lib/env";

import * as schema from "./schema";

export * from "./schema";

/**
 * Lazily-constructed singleton. Building the client at module scope would make
 * importing anything from this file require a live DATABASE_URL, which breaks
 * the pure EV engine's tests and any build-time import.
 *
 * In dev, Next's hot reload re-evaluates modules on every edit; stashing the
 * connection on globalThis stops us leaking a new pool per reload.
 */
const globalForDb = globalThis as unknown as {
  __packroiSql?: ReturnType<typeof postgres>;
};

let dbInstance: ReturnType<typeof buildDb> | null = null;

function buildDb() {
  const { DATABASE_URL } = getEnv();

  const client =
    globalForDb.__packroiSql ??
    postgres(DATABASE_URL, {
      // Serverless-friendly: Vercel functions are short-lived, so a large pool
      // just exhausts Postgres connection slots.
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
    });

  if (process.env.NODE_ENV !== "production") {
    globalForDb.__packroiSql = client;
  }

  return drizzle(client, { schema });
}

export function getDb() {
  if (!dbInstance) dbInstance = buildDb();
  return dbInstance;
}

export type Db = ReturnType<typeof getDb>;
