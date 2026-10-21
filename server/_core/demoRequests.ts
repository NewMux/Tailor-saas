import express, { type Express } from "express";
import rateLimit from "express-rate-limit";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { SALES_EMAIL } from "@shared/const";
import { demoRequests } from "../../drizzle/schema";
import { getDb } from "../db";
import { sendEmail } from "./email";
import { demoRequestEmail } from "./emailTemplates";
import { ENV } from "./env";
import { logger } from "./logger";
import { clientKey } from "./rateLimit";

export const DEMO_REQUEST_PATH = "/api/public/demo-request";

/**
 * The marketing site posts here from another origin. Only these origins get
 * CORS headers, and never with credentials: the request carries no session,
 * so allowing tafsell.com here does not open the rest of the API to it.
 */
export const DEMO_REQUEST_ORIGINS = ["https://tafsell.com", "https://www.tafsell.com"];

function isAllowedOrigin(origin: string) {
  if (DEMO_REQUEST_ORIGINS.includes(origin)) return true;
  // Local preview of the landing page (npx serve, etc.).
  return !ENV.isProduction && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

// No control characters (newlines in a subject line, etc.) in one-line fields.
const singleLine = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(value => !/[\u0000-\u001f\u007f]/.test(value), "must be a single line");

const demoRequestSchema = z.object({
  name: singleLine(160).pipe(z.string().min(1)),
  shopName: singleLine(160).pipe(z.string().min(1)),
  email: singleLine(320).pipe(z.string().email()),
  phone: singleLine(40).optional().default(""),
  message: z.string().trim().max(2000).optional().default(""),
  language: z.enum(["en", "ar"]).optional().default("en"),
  // Honeypot: hidden from people, filled in by naive bots.
  website: z.string().optional().default(""),
});

/**
 * "Book a demo" from tafsell.com: stores the request, then emails it to the
 * sales inbox with Reply-To set to the prospect. The row is written first so
 * a lead is kept even when email is not configured or Resend is down.
 */
export function registerDemoRequestRoute(app: Express) {
  app.use(DEMO_REQUEST_PATH, (req, res, next) => {
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
    if (origin && isAllowedOrigin(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Max-Age", "86400");
    }
    res.setHeader("Vary", "Origin");
    if (req.method === "OPTIONS") {
      res.sendStatus(origin && isAllowedOrigin(origin) ? 204 : 403);
      return;
    }
    next();
  });

  if (process.env.NODE_ENV !== "test") {
    app.post(
      DEMO_REQUEST_PATH,
      rateLimit({
        keyGenerator: request => clientKey(request.ip),
        windowMs: 60 * 60 * 1000,
        limit: 5,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        message: { error: { code: "RATE_LIMITED", message: "Too many requests. Please try again later." } },
      }),
    );
  }

  app.post(DEMO_REQUEST_PATH, express.json({ limit: "16kb" }), async (req, res, next) => {
    // Express 4 does not catch rejected promises; the app error handler logs and reports.
    try {
      const parsed = demoRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: "INVALID_REQUEST", message: "Please check the form and try again." } });
        return;
      }
      const input = parsed.data;
      if (input.website) {
        // Look like success so the bot moves on.
        logger.info({ ip: req.ip }, "Demo request dropped by honeypot");
        res.status(201).json({ ok: true });
        return;
      }

      const db = await getDb();
      if (!db) {
        res.status(503).json({ error: { code: "UNAVAILABLE", message: "Please try again shortly." } });
        return;
      }
      const details = {
        name: input.name,
        shopName: input.shopName,
        email: input.email,
        phone: input.phone || null,
        message: input.message || null,
        language: input.language,
      };
      const [row] = await db
        .insert(demoRequests)
        .values({ ...details, ip: req.ip?.slice(0, 64) ?? null })
        .returning({ id: demoRequests.id });

      const { sent } = await sendEmail(demoRequestEmail(SALES_EMAIL, details));
      if (sent) {
        await db.update(demoRequests).set({ notifiedAt: new Date() }).where(eq(demoRequests.id, row!.id));
      } else {
        logger.warn({ demoRequestId: row!.id }, "Demo request stored but the sales email was not sent");
      }
      res.status(201).json({ ok: true });
    } catch (err) {
      next(err);
    }
  });
}
