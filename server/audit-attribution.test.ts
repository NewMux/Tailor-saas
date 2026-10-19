import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { currentImpersonator, requestContext } from "./_core/requestContext";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "node_modules" ? [] : sourceFiles(full);
    return full.endsWith(".ts") && !full.endsWith(".test.ts") ? [full] : [];
  });
}

describe("audit attribution", () => {
  it("only the attributed writers insert into auditLogs", () => {
    const allowed = new Set(["erp/shared.ts", "pos/shared.ts", "admin.ts", "billing/webhook.ts"]);
    const offenders = sourceFiles(__dirname)
      .filter(file => /\.insert\(\s*auditLogs\s*\)/.test(readFileSync(file, "utf8")))
      .map(file => path.relative(__dirname, file))
      .filter(file => !allowed.has(file));
    expect(offenders).toEqual([]);
  });

  it("keeps the operator visible across awaits and inside a database transaction", async () => {
    await requestContext.run({ impersonatedBy: 42 }, async () => {
      expect(currentImpersonator()).toBe(42);
      await new Promise(resolve => setTimeout(resolve, 5));
      expect(currentImpersonator()).toBe(42);
      if (process.env.DATABASE_URL) {
        const db = (await getDb())!;
        await db.transaction(async tx => {
          await tx.execute(sql`select 1`);
          expect(currentImpersonator()).toBe(42);
        });
        expect(currentImpersonator()).toBe(42);
      }
    });
    expect(currentImpersonator()).toBeNull();
  });
});
