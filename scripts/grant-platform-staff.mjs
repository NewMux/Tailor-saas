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
const role = readArg("role") || "support";
const revoke = process.argv.includes("--revoke");

if (!email) {
  console.error("Usage: node scripts/grant-platform-staff.mjs --email you@example.com [--role support|superadmin] [--revoke]");
  process.exit(1);
}
if (!revoke && role !== "support" && role !== "superadmin") {
  console.error(`Invalid --role "${role}". Must be "support" or "superadmin".`);
  process.exit(1);
}

const sql = postgres(databaseUrl, { prepare: false });

const [user] = await sql`SELECT "id", "name", "email" FROM "users" WHERE lower("email") = ${email} LIMIT 1`;
if (!user) {
  console.error(`No account found for ${email}. The person must sign up first.`);
  await sql.end();
  process.exit(1);
}

if (revoke) {
  await sql`UPDATE "platformStaff" SET "isActive" = false, "updatedAt" = now() WHERE "userId" = ${user.id}`;
  console.log(`Revoked platform staff access for ${user.email} (user #${user.id}).`);
} else {
  await sql`
    INSERT INTO "platformStaff" ("userId", "role", "isActive", "grantedBy")
    VALUES (${user.id}, ${role}, true, NULL)
    ON CONFLICT ("userId") DO UPDATE SET "role" = ${role}, "isActive" = true, "updatedAt" = now()
  `;
  console.log(`Granted "${role}" platform staff access to ${user.email} (user #${user.id}).`);
}

await sql.end();
