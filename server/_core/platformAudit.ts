import type { Request } from "express";
import { platformAuditLogs } from "../../drizzle/schema";
import { getDb } from "../db";

export type PlatformAuditEntry = {
  actor?: { id: number; email?: string | null } | null;
  action: string;
  targetType: string;
  targetId?: number | null;
  organizationId?: number | null;
  details?: unknown;
  source?: "app" | "cli";
  req?: Pick<Request, "ip" | "headers"> | null;
};

/** Operator actions that are not owned by one shop (the shop-visible copy, if any, is written separately). */
export async function platformAudit(entry: PlatformAuditEntry) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const userAgent = entry.req?.headers?.["user-agent"];
  await db.insert(platformAuditLogs).values({
    actorId: entry.actor?.id ?? null,
    actorEmail: entry.actor?.email ?? null,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId ?? null,
    organizationId: entry.organizationId ?? null,
    detailsJson: entry.details === undefined ? null : JSON.stringify(entry.details),
    source: entry.source ?? "app",
    ip: entry.req?.ip ?? null,
    userAgent: typeof userAgent === "string" ? userAgent.slice(0, 255) : null,
  });
}
