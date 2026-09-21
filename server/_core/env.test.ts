import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

function baseEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return { DATABASE_URL: "postgres://erp:pw@localhost:5432/tailor_erp", ...overrides } as NodeJS.ProcessEnv;
}

describe("parseEnv", () => {
  it("accepts a minimal valid environment", () => {
    expect(parseEnv(baseEnv())).toEqual({ success: true });
  });

  it("accepts a full valid production environment", () => {
    const result = parseEnv(
      baseEnv({
        NODE_ENV: "production",
        AUTH_BASE_URL: "https://erp.example.com",
        PORT: "3000",
        ALLOWED_ORIGIN: "https://erp.example.com",
        LOG_LEVEL: "info",
        SENTRY_DSN: "https://key@sentry.io/123",
        BUILT_IN_FORGE_API_URL: "https://forge.example.com",
        BUILT_IN_FORGE_API_KEY: "secret",
      })
    );
    expect(result).toEqual({ success: true });
  });

  it("rejects a missing DATABASE_URL", () => {
    const result = parseEnv(baseEnv({ DATABASE_URL: "" }));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors.join("\n")).toMatch(/DATABASE_URL/);
  });

  it("requires AUTH_BASE_URL only when NODE_ENV=production", () => {
    expect(parseEnv(baseEnv({ NODE_ENV: "development" })).success).toBe(true);
    const result = parseEnv(baseEnv({ NODE_ENV: "production" }));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors.join("\n")).toMatch(/AUTH_BASE_URL/);
  });

  it("rejects a malformed AUTH_BASE_URL even outside production", () => {
    const result = parseEnv(baseEnv({ AUTH_BASE_URL: "not-a-url" }));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors.join("\n")).toMatch(/AUTH_BASE_URL/);
  });

  it("rejects a non-numeric or non-positive PORT", () => {
    expect(parseEnv(baseEnv({ PORT: "abc" })).success).toBe(false);
    expect(parseEnv(baseEnv({ PORT: "0" })).success).toBe(false);
    expect(parseEnv(baseEnv({ PORT: "-1" })).success).toBe(false);
    expect(parseEnv(baseEnv({ PORT: "3000" })).success).toBe(true);
  });

  it("rejects an unknown NODE_ENV value (catches typos)", () => {
    expect(parseEnv(baseEnv({ NODE_ENV: "producton" })).success).toBe(false);
  });

  it("rejects an unknown LOG_LEVEL", () => {
    expect(parseEnv(baseEnv({ LOG_LEVEL: "verbose" })).success).toBe(false);
    expect(parseEnv(baseEnv({ LOG_LEVEL: "debug" })).success).toBe(true);
  });

  it("rejects setting only one of BUILT_IN_FORGE_API_URL / BUILT_IN_FORGE_API_KEY", () => {
    expect(parseEnv(baseEnv({ BUILT_IN_FORGE_API_URL: "https://forge.example.com" })).success).toBe(false);
    expect(parseEnv(baseEnv({ BUILT_IN_FORGE_API_KEY: "secret" })).success).toBe(false);
    expect(
      parseEnv(baseEnv({ BUILT_IN_FORGE_API_URL: "https://forge.example.com", BUILT_IN_FORGE_API_KEY: "secret" })).success
    ).toBe(true);
  });

  it("rejects a malformed SENTRY_DSN", () => {
    expect(parseEnv(baseEnv({ SENTRY_DSN: "not-a-url" })).success).toBe(false);
  });
});
