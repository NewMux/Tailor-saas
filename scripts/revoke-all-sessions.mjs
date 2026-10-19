// Signs every user out (deletes all rows in "authSessions"). Run once after a
// release that closes a session-token exposure, or any time you need a clean
// slate: DATABASE_URL=... pnpm auth:revoke-sessions
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const sql = postgres(databaseUrl, { prepare: false });
const deleted = await sql`DELETE FROM "authSessions" RETURNING "id"`;
console.log(`Revoked ${deleted.length} session(s). Everyone must sign in again.`);
await sql.end();
