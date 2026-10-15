/**
 * Vercel build (vercel.json "buildCommand"). Writes the Build Output API
 * layout directly so routing and the function's runtime settings live in
 * this repo rather than in Vercel's framework detection:
 *
 *   .vercel/output/static/          built React app (vite build)
 *   .vercel/output/functions/api.func/  Express app, bundled with esbuild
 *   .vercel/output/config.json      routes: static files first, then
 *                                   /api/* and /manus-storage/* to the
 *                                   function, everything else to index.html
 *
 * Production builds (VERCEL_ENV=production) also validate the environment
 * and apply pending database migrations, so a misconfigured or unmigrated
 * deploy fails at build time instead of serving errors.
 */
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { parseEnv } from "../server/_core/env";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, ".vercel", "output");
const functionDir = path.join(output, "functions", "api.func");
const isProductionDeploy = process.env.VERCEL_ENV === "production";

function run(command: string, env: NodeJS.ProcessEnv = process.env) {
  console.log(`$ ${command}`);
  execSync(command, { cwd: root, stdio: "inherit", env });
}

if (isProductionDeploy) {
  const result = parseEnv({ ...process.env, NODE_ENV: "production" });
  if (!result.success) {
    console.error(
      `Invalid production environment:\n${result.errors.map(e => `  - ${e}`).join("\n")}`
    );
    process.exit(1);
  }

  // The runtime DATABASE_URL is Supabase's transaction pooler, which can't
  // run migrations reliably; they go through the session pooler instead.
  const migrationUrl = process.env.MIGRATION_DATABASE_URL?.trim();
  if (!migrationUrl) {
    console.error(
      "MIGRATION_DATABASE_URL is required for production builds (see DEPLOYMENT.md)."
    );
    process.exit(1);
  }
  run("pnpm exec drizzle-kit migrate", {
    ...process.env,
    DATABASE_URL: migrationUrl,
  });
} else {
  console.log(
    `Skipping env validation and migrations (VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"}).`
  );
}

rmSync(output, { recursive: true, force: true });

run("pnpm exec vite build");
cpSync(path.join(root, "dist", "public"), path.join(output, "static"), {
  recursive: true,
});

mkdirSync(functionDir, { recursive: true });
await build({
  entryPoints: [path.join(root, "server", "_core", "vercel.ts")],
  outfile: path.join(functionDir, "index.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: "linked",
  // Fully self-contained: the function ships without node_modules.
  // createRequire lets bundled CommonJS dependencies require Node built-ins.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});

writeFileSync(
  path.join(functionDir, ".vc-config.json"),
  JSON.stringify(
    {
      runtime: "nodejs22.x",
      handler: "index.mjs",
      launcherType: "Nodejs",
      // Hand Express the raw Node request: the Paddle webhook verifies its
      // signature over the unparsed body, which Vercel's helpers would consume.
      shouldAddHelpers: false,
      maxDuration: 30,
      // Tokyo, next to the Supabase project (ap-northeast-1).
      regions: [process.env.VERCEL_FUNCTION_REGION?.trim() || "hnd1"],
    },
    null,
    2
  )
);

const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

writeFileSync(
  path.join(output, "config.json"),
  JSON.stringify(
    {
      version: 3,
      routes: [
        {
          src: "^/assets/(.*)$",
          headers: { "Cache-Control": "public, max-age=31536000, immutable" },
          continue: true,
        },
        { src: "^/(.*)$", headers: securityHeaders, continue: true },
        // The service worker must be revalidated so app updates reach clients.
        {
          src: "^/(sw\\.js|manifest\\.json)$",
          headers: { "Cache-Control": "no-cache" },
          continue: true,
        },
        { handle: "filesystem" },
        { src: "^/(api|manus-storage)(/.*)?$", dest: "/api" },
        {
          src: "^/(.*)$",
          dest: "/index.html",
          headers: { "Cache-Control": "no-cache" },
        },
      ],
    },
    null,
    2
  )
);

console.log(`Vercel build output written to ${path.relative(root, output)}`);
