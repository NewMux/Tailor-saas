import type { Express } from "express";
import { and, eq } from "drizzle-orm";
import {
  customRoles,
  staffDocuments,
  userBusinessRoles,
  userCustomRoles,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { orgScope } from "./tenantDb";
import { sdk } from "./sdk";
import { isStorageConfigured, storageGetSignedUrl } from "../storage";
import { logger } from "./logger";
import { captureError } from "./sentry";

async function canReadStaffDocuments(userId: number, organizationId: number) {
  const db = await getDb();
  if (!db) return false;
  const businessRole = (
    await db
      .select({
        role: userBusinessRoles.role,
        isActive: userBusinessRoles.isActive,
      })
      .from(userBusinessRoles)
      .where(
        and(
          eq(userBusinessRoles.userId, userId),
          orgScope(userBusinessRoles, organizationId)
        )
      )
      .limit(1)
  )[0];
  if (!businessRole?.isActive) return false;
  if (businessRole.role === "admin" || businessRole.role === "payroll")
    return true;
  const assignment = (
    await db
      .select({
        customRoleId: userCustomRoles.customRoleId,
        isActive: userCustomRoles.isActive,
      })
      .from(userCustomRoles)
      .where(
        and(
          eq(userCustomRoles.userId, userId),
          orgScope(userCustomRoles, organizationId)
        )
      )
      .limit(1)
  )[0];
  if (!assignment?.isActive) return false;
  const customRole = (
    await db
      .select({
        permissionsJson: customRoles.permissionsJson,
        isActive: customRoles.isActive,
      })
      .from(customRoles)
      .where(
        and(
          eq(customRoles.id, assignment.customRoleId),
          orgScope(customRoles, organizationId)
        )
      )
      .limit(1)
  )[0];
  const permissions = Array.isArray(customRole?.permissionsJson)
    ? customRole.permissionsJson.filter(
        (value): value is string => typeof value === "string"
      )
    : [];
  return Boolean(customRole?.isActive && permissions.includes("payroll"));
}

export function registerStorageProxy(app: Express) {
  app.get("/manus-storage/*", async (req, res) => {
    const key = (req.params as Record<string, string>)[0];
    if (!key || key.length > 500) {
      res.status(400).send("Invalid storage key");
      return;
    }

    if (!isStorageConfigured()) {
      res.status(500).send("Storage proxy not configured");
      return;
    }

    try {
      const { user } = await sdk.authenticateRequest(req);
      if (!user.organizationId) {
        res.status(403).send("You are not permitted to access this document.");
        return;
      }
      if (!(await canReadStaffDocuments(user.id, user.organizationId))) {
        res.status(403).send("You are not permitted to access this document.");
        return;
      }

      const db = await getDb();
      if (!db) {
        res.status(503).send("Database unavailable");
        return;
      }
      const document = (
        await db
          .select({ id: staffDocuments.id })
          .from(staffDocuments)
          .where(
            and(
              eq(staffDocuments.storageKey, key),
              orgScope(staffDocuments, user.organizationId)
            )
          )
          .limit(1)
      )[0];
      if (!document) {
        res.status(404).send("Document not found");
        return;
      }

      let url: string;
      try {
        url = await storageGetSignedUrl(key);
      } catch (err) {
        logger.error({ err }, "Storage proxy backend error");
        res.status(502).send("Storage backend error");
        return;
      }

      res.set({
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      });
      res.redirect(307, url);
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      if (
        message === "Missing session" ||
        message === "Invalid session" ||
        message === "Session verification unavailable" ||
        message === "Server authentication is not configured"
      ) {
        res.status(401).send("Authentication required");
        return;
      }
      logger.error({ err }, "Storage proxy failed");
      captureError(err);
      res.status(502).send("Storage proxy error");
    }
  });
}
