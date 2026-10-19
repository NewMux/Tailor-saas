import type { Express } from "express";
import { and, eq } from "drizzle-orm";
import {
  customRoles,
  staffDocuments,
  userBusinessRoles,
  userCustomRoles,
} from "../../drizzle/schema";
import { HttpError } from "@shared/_core/errors";
import { getDb } from "../db";
import { orgScope } from "./tenantDb";
import { TRPCError } from "@trpc/server";
import { payrollRoles, resolveAccess } from "./access";
import { sdk } from "./sdk";
import { isStorageConfigured, storageGetSignedUrl } from "../storage";
import { logger } from "./logger";
import { captureError } from "./sentry";

async function canReadStaffDocuments(userId: number, organizationId: number) {
  try {
    await resolveAccess(userId, organizationId, payrollRoles);
    return true;
  } catch (error) {
    if (error instanceof TRPCError) return false;
    throw error;
  }
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
      const { user, impersonatedBy } = await sdk.authenticateRequest(req);
      // Staff documents are personal data: operators never read them by
      // borrowing a shop user's session, in read-only or write mode.
      if (impersonatedBy) {
        res.status(403).send("Documents are not available during impersonation.");
        return;
      }
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
      // sdk.authenticateRequest throws an HttpError(403) when there is no valid session.
      if (err instanceof HttpError) {
        res.status(401).send("Authentication required");
        return;
      }
      logger.error({ err }, "Storage proxy failed");
      captureError(err);
      res.status(502).send("Storage proxy error");
    }
  });
}
