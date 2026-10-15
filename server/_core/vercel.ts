// Vercel serverless entrypoint: the same Express app as the long-running
// server (server/_core/index.ts), minus listen() and graceful shutdown,
// which Vercel's runtime handles. scripts/build-vercel.ts bundles this file
// into the single "api" function that serves /api/* and /manus-storage/*;
// the built frontend is served as static files by Vercel itself.
import { createApp } from "./app";
import { validateEnv } from "./env";
import { initSentry } from "./sentry";

validateEnv();
initSentry();

export default createApp();
