import { z } from "zod";

function cleanEnvironmentValue(value: string | undefined): string {
  return value?.trim().replace(/^['\"]|['\"]$/g, "") ?? "";
}

export const ENV = {
  databaseUrl: cleanEnvironmentValue(process.env.DATABASE_URL),
  authBaseUrl: cleanEnvironmentValue(process.env.AUTH_BASE_URL),
  allowedOrigin: cleanEnvironmentValue(process.env.ALLOWED_ORIGIN),
  isProduction: process.env.NODE_ENV === "production",
  secureCookies: process.env.NODE_ENV === "production",
  forgeApiUrl: cleanEnvironmentValue(process.env.BUILT_IN_FORGE_API_URL),
  forgeApiKey: cleanEnvironmentValue(process.env.BUILT_IN_FORGE_API_KEY),
};

const PINO_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

const envSchema = z
  .object({
    DATABASE_URL: z.string().trim().min(1, "is required"),
    AUTH_BASE_URL: z.string().trim().optional(),
    NODE_ENV: z.enum(["development", "production", "test"]).optional(),
    PORT: z.string().trim().optional(),
    ALLOWED_ORIGIN: z.string().optional(),
    LOG_LEVEL: z.enum(PINO_LEVELS).optional(),
    SENTRY_DSN: z.string().trim().optional(),
    BUILT_IN_FORGE_API_URL: z.string().trim().optional(),
    BUILT_IN_FORGE_API_KEY: z.string().trim().optional(),
  })
  .superRefine((raw, ctx) => {
    const authBaseUrl = cleanEnvironmentValue(raw.AUTH_BASE_URL);
    if (raw.NODE_ENV === "production" && !authBaseUrl) {
      ctx.addIssue({ code: "custom", path: ["AUTH_BASE_URL"], message: "is required when NODE_ENV=production" });
    } else if (authBaseUrl && !isValidUrl(authBaseUrl)) {
      ctx.addIssue({ code: "custom", path: ["AUTH_BASE_URL"], message: "must be a valid URL" });
    }

    if (raw.PORT !== undefined && raw.PORT !== "") {
      const port = Number(raw.PORT);
      if (!Number.isInteger(port) || port <= 0) {
        ctx.addIssue({ code: "custom", path: ["PORT"], message: "must be a positive integer" });
      }
    }

    const sentryDsn = cleanEnvironmentValue(raw.SENTRY_DSN);
    if (sentryDsn && !isValidUrl(sentryDsn)) {
      ctx.addIssue({ code: "custom", path: ["SENTRY_DSN"], message: "must be a valid URL" });
    }

    const forgeUrlSet = Boolean(cleanEnvironmentValue(raw.BUILT_IN_FORGE_API_URL));
    const forgeKeySet = Boolean(cleanEnvironmentValue(raw.BUILT_IN_FORGE_API_KEY));
    if (forgeUrlSet !== forgeKeySet) {
      ctx.addIssue({
        code: "custom",
        path: ["BUILT_IN_FORGE_API_URL"],
        message: "BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY must both be set, or both left unset",
      });
    }
  });

export type EnvValidationResult = { success: true } | { success: false; errors: string[] };

/**
 * Pure validation, no process exit — unit-testable, and safe to import from
 * modules (like server/db.ts) that run in tests without DATABASE_URL set.
 */
export function parseEnv(raw: NodeJS.ProcessEnv): EnvValidationResult {
  const result = envSchema.safeParse(raw);
  if (result.success) return { success: true };
  const errors = result.error.issues.map(issue => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
  return { success: false, errors };
}

/**
 * Fail-fast entrypoint check. Only call this from the real process
 * entrypoint (server/_core/index.ts) — never at module load time, or every
 * test file that transitively imports ENV would need DATABASE_URL set.
 */
export function validateEnv(): void {
  const result = parseEnv(process.env);
  if (!result.success) {
    console.error(`Invalid environment configuration:\n${result.errors.map(e => `  - ${e}`).join("\n")}`);
    process.exit(1);
  }
}
