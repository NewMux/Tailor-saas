import "dotenv/config";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import pinoHttp from "pino-http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { registerStorageProxy } from "./storageProxy";
import { registerAuthRoutes } from "./localAuth";
import { registerPaddleWebhook } from "./paddleWebhook";
import { ENV } from "./env";
import { logger } from "./logger";
import { captureError } from "./sentry";

function registerCors(app: Express) {
  const allowedOrigins = ENV.allowedOrigin
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean);

  app.use((req, res, next) => {
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
    const isAllowed = origin && (allowedOrigins.length > 0 ? allowedOrigins.includes(origin) : !ENV.isProduction);
    if (isAllowed) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      res.sendStatus(isAllowed ? 204 : 403);
      return;
    }
    next();
  });
}

/**
 * Builds the Express app shared by the local development server and the
 * standalone Hetzner production process.
 */
export function createApp(): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(pinoHttp({ logger, autoLogging: { ignore: req => req.url === "/api/auth/session" } }));
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader("Cache-Control", "no-store");
    if (req.secure || req.headers["x-forwarded-proto"] === "https") {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
  });
  registerCors(app);
  // Mounted before express.json(): Paddle signs the raw request bytes, so the
  // webhook route needs them intact to verify the signature.
  registerPaddleWebhook(app);
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ limit: "10mb", extended: true }));
  registerAuthRoutes(app);
  registerStorageProxy(app);
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
      onError({ error, path }) {
        if (error.code === "INTERNAL_SERVER_ERROR") {
          logger.error({ err: error, path }, "tRPC internal error");
          captureError(error);
        }
      },
    }),
  );
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    logger.error({ err }, "Unhandled request error");
    captureError(err);
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong." } });
  });
  return app;
}
