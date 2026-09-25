import { z } from "zod";

function cleanEnvironmentValue(value: string | undefined): string {
  return value?.trim().replace(/^['\"]|['\"]$/g, "") ?? "";
}

function parseTrialDays(value: string): number {
  const days = Number(value);
  return value && Number.isInteger(days) && days >= 0 ? days : 14;
}

export const ENV = {
  databaseUrl: cleanEnvironmentValue(process.env.DATABASE_URL),
  authBaseUrl: cleanEnvironmentValue(process.env.AUTH_BASE_URL),
  allowedOrigin: cleanEnvironmentValue(process.env.ALLOWED_ORIGIN),
  isProduction: process.env.NODE_ENV === "production",
  secureCookies: process.env.NODE_ENV === "production",
  forgeApiUrl: cleanEnvironmentValue(process.env.BUILT_IN_FORGE_API_URL),
  forgeApiKey: cleanEnvironmentValue(process.env.BUILT_IN_FORGE_API_KEY),
  resendApiKey: cleanEnvironmentValue(process.env.RESEND_API_KEY),
  emailFrom: cleanEnvironmentValue(process.env.EMAIL_FROM),
  paddleEnvironment: (cleanEnvironmentValue(process.env.PADDLE_ENV) === "production" ? "production" : "sandbox") as "production" | "sandbox",
  paddleApiKey: cleanEnvironmentValue(process.env.PADDLE_API_KEY),
  paddleClientToken: cleanEnvironmentValue(process.env.PADDLE_CLIENT_TOKEN),
  paddlePriceId: cleanEnvironmentValue(process.env.PADDLE_PRICE_ID),
  paddleWebhookSecret: cleanEnvironmentValue(process.env.PADDLE_WEBHOOK_SECRET),
  trialDays: parseTrialDays(cleanEnvironmentValue(process.env.TRIAL_DAYS)),
  s3Endpoint: cleanEnvironmentValue(process.env.S3_ENDPOINT),
  s3Region: cleanEnvironmentValue(process.env.S3_REGION),
  s3Bucket: cleanEnvironmentValue(process.env.S3_BUCKET),
  s3AccessKeyId: cleanEnvironmentValue(process.env.S3_ACCESS_KEY_ID),
  s3SecretAccessKey: cleanEnvironmentValue(process.env.S3_SECRET_ACCESS_KEY),
};

/** Transactional email is sent only when both Resend settings are present. */
export function isEmailConfigured() {
  return Boolean(ENV.resendApiKey && ENV.emailFrom);
}

/**
 * Billing (trial expiry, read-only enforcement, checkout) only switches on
 * when every Paddle setting is present. Without it there is no way for a
 * shop to pay, so nobody may be locked out.
 */
export function isBillingEnabled() {
  return Boolean(ENV.paddleApiKey && ENV.paddleClientToken && ENV.paddlePriceId && ENV.paddleWebhookSecret);
}

export function isS3Configured() {
  return Boolean(ENV.s3Endpoint && ENV.s3Region && ENV.s3Bucket && ENV.s3AccessKeyId && ENV.s3SecretAccessKey);
}

const ALL_OR_NONE_GROUPS: Array<{ name: string; keys: string[] }> = [
  { name: "Email (Resend)", keys: ["RESEND_API_KEY", "EMAIL_FROM"] },
  { name: "Billing (Paddle)", keys: ["PADDLE_API_KEY", "PADDLE_CLIENT_TOKEN", "PADDLE_PRICE_ID", "PADDLE_WEBHOOK_SECRET"] },
  { name: "File storage (S3)", keys: ["S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] },
];

// "Name <addr@host>" or a bare "addr@host".
const EMAIL_FROM_PATTERN = /^(?:[^<>]+<\s*[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+\s*>|[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)$/;

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
    RESEND_API_KEY: z.string().trim().optional(),
    EMAIL_FROM: z.string().trim().optional(),
    PADDLE_ENV: z.string().trim().optional(),
    PADDLE_API_KEY: z.string().trim().optional(),
    PADDLE_CLIENT_TOKEN: z.string().trim().optional(),
    PADDLE_PRICE_ID: z.string().trim().optional(),
    PADDLE_WEBHOOK_SECRET: z.string().trim().optional(),
    TRIAL_DAYS: z.string().trim().optional(),
    S3_ENDPOINT: z.string().trim().optional(),
    S3_REGION: z.string().trim().optional(),
    S3_BUCKET: z.string().trim().optional(),
    S3_ACCESS_KEY_ID: z.string().trim().optional(),
    S3_SECRET_ACCESS_KEY: z.string().trim().optional(),
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

    const rawValues = raw as Record<string, string | undefined>;
    for (const group of ALL_OR_NONE_GROUPS) {
      const set = group.keys.filter(key => Boolean(cleanEnvironmentValue(rawValues[key])));
      if (set.length > 0 && set.length < group.keys.length) {
        const missing = group.keys.filter(key => !set.includes(key));
        ctx.addIssue({
          code: "custom",
          path: [missing[0]],
          message: `${group.name} is partially configured: set ${missing.join(", ")} too, or leave all of ${group.keys.join(", ")} unset`,
        });
      }
    }

    const emailFrom = cleanEnvironmentValue(raw.EMAIL_FROM);
    if (emailFrom && !EMAIL_FROM_PATTERN.test(emailFrom)) {
      ctx.addIssue({ code: "custom", path: ["EMAIL_FROM"], message: 'must be an email address or "Name <address>"' });
    }

    const paddleEnv = cleanEnvironmentValue(raw.PADDLE_ENV);
    if (paddleEnv && paddleEnv !== "sandbox" && paddleEnv !== "production") {
      ctx.addIssue({ code: "custom", path: ["PADDLE_ENV"], message: 'must be "sandbox" or "production"' });
    }

    const trialDays = cleanEnvironmentValue(raw.TRIAL_DAYS);
    if (trialDays) {
      const days = Number(trialDays);
      if (!Number.isInteger(days) || days < 0 || days > 365) {
        ctx.addIssue({ code: "custom", path: ["TRIAL_DAYS"], message: "must be a whole number of days between 0 and 365" });
      }
    }

    const s3Endpoint = cleanEnvironmentValue(raw.S3_ENDPOINT);
    if (s3Endpoint && !isValidUrl(s3Endpoint)) {
      ctx.addIssue({ code: "custom", path: ["S3_ENDPOINT"], message: "must be a valid URL" });
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
