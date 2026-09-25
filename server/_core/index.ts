import "dotenv/config";
import { createServer } from "http";
import net from "net";
import { initSentry } from "./sentry";
import { createApp } from "./app";
import { serveStatic, setupVite } from "./vite";
import { logger } from "./logger";
import { validateEnv } from "./env";
import { closeDb } from "../db";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  validateEnv();
  initSentry();
  const app = createApp();
  const server = createServer(app);

  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  // Only hunt for a free port in local development. In production the
  // platform routes traffic to exactly PORT, so silently binding elsewhere
  // would leave the app unreachable while looking healthy in the logs.
  const port = process.env.NODE_ENV === "development" ? await findAvailablePort(preferredPort) : preferredPort;

  if (port !== preferredPort) {
    logger.warn({ preferredPort, port }, "Preferred port busy, using fallback port");
  }

  server.listen(port, () => {
    logger.info({ port }, "Server listening");
  });

  // Deploys and restarts send SIGTERM: stop accepting connections, let
  // in-flight requests (e.g. a POS checkout) finish, then close the pool.
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Shutting down");
    const forceExit = setTimeout(() => {
      logger.warn("Graceful shutdown timed out, forcing exit");
      process.exit(1);
    }, 10_000);
    forceExit.unref();
    server.close(async () => {
      try {
        await closeDb();
      } catch (err) {
        logger.error({ err }, "Error closing database pool");
      }
      process.exit(0);
    });
    server.closeIdleConnections?.();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

startServer().catch(err => {
  logger.fatal({ err }, "Server failed to start");
  process.exit(1);
});
