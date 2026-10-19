import { createHash, randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

function readArg(name) {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

const email = readArg("email")?.trim().toLowerCase();
const name = readArg("name")?.trim();
const role = readArg("role") || "support";
const revoke = process.argv.includes("--revoke");

if (!email) {
  console.error(
    "Usage: node scripts/grant-platform-staff.mjs --email you@example.com [--name \"Full Name\"] [--role support|superadmin] [--revoke]\n" +
      "If the account does not exist it is created (platform-only, no shop) and a one-time setup link is printed; pass --name for that case."
  );
  process.exit(1);
}
if (!revoke && role !== "support" && role !== "superadmin") {
  console.error(`Invalid --role "${role}". Must be "support" or "superadmin".`);
  process.exit(1);
}

const sql = postgres(databaseUrl, { prepare: false });

try {
  await sql.begin(async tx => {
    let [user] = await tx`SELECT "id", "name", "email" FROM "users" WHERE lower("email") = ${email} LIMIT 1`;
    let setupLink;

    if (revoke) {
      if (!user) throw new Error(`No account found for ${email}.`);
      await tx`UPDATE "platformStaff" SET "isActive" = false, "updatedAt" = now() WHERE "userId" = ${user.id}`;
      await tx`DELETE FROM "authSessions" WHERE "userId" = ${user.id} OR "impersonatedBy" = ${user.id}`;
      await tx`INSERT INTO "platformAuditLogs" ("actorId", "action", "targetType", "targetId", "detailsJson", "source") VALUES (NULL, 'STAFF_REVOKED', 'user', ${user.id}, ${JSON.stringify({ email, via: "cli" })}, 'cli')`;
      console.log(`Revoked platform staff access for ${user.email} (user #${user.id}).`);
      return;
    }

    if (!user) {
      if (!name || name.length < 2) throw new Error(`No account found for ${email}. Pass --name "Full Name" to create a platform-only account.`);
      [user] = await tx`
        INSERT INTO "users" ("openId", "name", "email", "loginMethod", "role")
        VALUES (${`local_${randomUUID()}`}, ${name}, ${email}, 'local', 'user')
        RETURNING "id", "name", "email"`;
      const token = `reset_${randomBytes(32).toString("base64url")}`;
      await tx`
        INSERT INTO "passwordResetTokens" ("tokenHash", "userId", "expiresAt")
        VALUES (${createHash("sha256").update(token).digest("hex")}, ${user.id}, ${new Date(Date.now() + 24 * 60 * 60 * 1000)})`;
      const base = (process.env.AUTH_BASE_URL ?? "").trim().replace(/\/$/, "");
      setupLink = `${base}/?reset_token=${encodeURIComponent(token)}`;
    }

    await tx`
      INSERT INTO "platformStaff" ("userId", "role", "isActive", "grantedBy")
      VALUES (${user.id}, ${role}, true, NULL)
      ON CONFLICT ("userId") DO UPDATE SET "role" = ${role}, "isActive" = true, "updatedAt" = now()`;
    // Sessions opened under normal-user rules must not survive the move to operator rules.
    await tx`DELETE FROM "authSessions" WHERE "userId" = ${user.id}`;
    await tx`INSERT INTO "platformAuditLogs" ("actorId", "action", "targetType", "targetId", "detailsJson", "source") VALUES (NULL, 'STAFF_GRANTED', 'user', ${user.id}, ${JSON.stringify({ email, role, via: "cli", created: Boolean(setupLink) })}, 'cli')`;
    console.log(`Granted "${role}" platform staff access to ${user.email} (user #${user.id}).`);
    if (setupLink) console.log(`Setup link (valid 24 hours, share it privately): ${setupLink}`);
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
