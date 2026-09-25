import type { Express } from "express";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { logger } from "./logger";

/**
 * Liveness + readiness probe for the platform health check. Unlike
 * /api/auth/session it actually round-trips to Postgres, so a container
 * whose database connection is broken is reported unhealthy and restarted.
 */
export function registerHealthRoute(app: Express) {
  app.get("/api/health", async (_req, res) => {
    try {
      const db = await getDb();
      if (!db) throw new Error("DATABASE_URL is not configured");
      await db.execute(sql`select 1`);
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, "Health check failed");
      res.status(503).json({ ok: false });
    }
  });
}
