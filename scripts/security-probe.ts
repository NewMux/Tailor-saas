/**
 * Black-box security probe. Talks to a running deployment over HTTP only.
 *
 *   pnpm security:probe --base-url https://app.example.com
 *       [--mode readonly|full] [--supabase-url https://<ref>.supabase.co --anon-key <publishable key>]
 *       [--bootstrap]            (full mode: create an operator through the CLI; needs DATABASE_URL)
 *       [--operator-email x --operator-password y]   (full mode: use an existing operator)
 *
 * readonly (default) sends only GETs and a few harmless unauthenticated POSTs,
 * so it is safe against production. full creates two throwaway shops, tries to
 * read and change one from the other, then suspends both; use it on local or
 * CI deployments, never on production data.
 *
 * Exit code 1 if any check FAILs. WARN means "look at this", not a failure.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

type Level = "PASS" | "FAIL" | "WARN";
const results: Array<{ level: Level; name: string; detail: string }> = [];
const record = (level: Level, name: string, detail = "") => {
  results.push({ level, name, detail });
  console.log(`${level.padEnd(4)}  ${name}${detail ? ` - ${detail}` : ""}`);
};
const check = (ok: boolean, name: string, detail = "", failLevel: Level = "FAIL") => record(ok ? "PASS" : failLevel, name, ok ? "" : detail);

function arg(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const baseUrl = (arg("base-url") ?? "").replace(/\/$/, "");
const mode = arg("mode") ?? "readonly";
if (!/^https?:\/\//.test(baseUrl)) {
  console.error("Usage: pnpm security:probe --base-url https://app.example.com [--mode readonly|full]");
  process.exit(2);
}
if (mode !== "readonly" && mode !== "full") {
  console.error('--mode must be "readonly" or "full"');
  process.exit(2);
}
const isHttps = baseUrl.startsWith("https://");

async function http(path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, { redirect: "manual", ...init });
  const text = await response.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: response.status, headers: response.headers, text, json };
}

/** tRPC over HTTP with the superjson wrapper. */
async function trpc(path: string, type: "query" | "mutation", input?: unknown, token?: string) {
  const headers: Record<string, string> = { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) };
  const response =
    type === "query"
      ? await http(`/api/trpc/${path}${input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`}`, { headers })
      : await http(`/api/trpc/${path}`, { method: "POST", headers, body: JSON.stringify({ json: input ?? {} }) });
  return {
    status: response.status,
    code: response.json?.error?.json?.data?.code as string | undefined,
    message: response.json?.error?.json?.message as string | undefined,
    data: response.json?.result?.data?.json,
  };
}

async function readonlyChecks() {
  console.log(`\n== Read-only checks against ${baseUrl}`);
  const home = await http("/");
  check(home.status === 200, "home page loads", `status ${home.status}`);
  check(!home.text.includes("manus-runtime"), "no Manus dev runtime in the page");
  check(home.headers.get("x-content-type-options") === "nosniff", "X-Content-Type-Options: nosniff");
  const frames = home.headers.get("x-frame-options") === "DENY" || /frame-ancestors\s+'none'/.test(home.headers.get("content-security-policy") ?? "");
  check(frames, "clickjacking protection (X-Frame-Options or frame-ancestors)");
  check(Boolean(home.headers.get("referrer-policy")), "Referrer-Policy is set");
  if (isHttps) check(Boolean(home.headers.get("strict-transport-security")), "HSTS is set");
  const csp = home.headers.get("content-security-policy");
  const report = home.headers.get("content-security-policy-report-only");
  if (csp) record("PASS", "Content-Security-Policy is enforced");
  else record("WARN", "Content-Security-Policy", report ? "only report-only so far" : "not set");

  const health = await http("/api/health");
  check(health.status === 200, "health endpoint answers", `status ${health.status}`);

  // Unauthenticated callers are refused by every non-public procedure we try.
  for (const [path, type] of [
    ["erp.customers.list", "query"],
    ["erp.staff.list", "query"],
    ["pos.catalog.list", "query"],
    ["admin.organizations.list", "query"],
    ["admin.security.status", "query"],
    ["admin.staff.revoke", "mutation"],
  ] as const) {
    const result = await trpc(path, type, type === "mutation" ? { userId: 1, reason: "probe" } : undefined);
    check(result.code === "UNAUTHORIZED", `${path} refuses anonymous callers`, `got ${result.status} ${result.code ?? ""}`);
  }
  const storage = await http("/manus-storage/org/1/staff/1/probe.pdf");
  check(storage.status === 401, "document proxy refuses anonymous callers", `status ${storage.status}`);

  const cors = await http("/api/trpc/system.health", { headers: { origin: "https://evil.example" } });
  check(!cors.headers.get("access-control-allow-origin"), "CORS does not allow foreign origins");
  const preflight = await http("/api/trpc/system.health", { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "POST" } });
  check(preflight.status === 403 || preflight.status === 404 || !preflight.headers.get("access-control-allow-origin"), "CORS preflight from a foreign origin is refused");

  const register = await http("/api/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Probe", email: "probe@example.invalid", password: "probe-password-1" }) });
  check(register.status === 403 && register.json?.error?.code === "SIGNUP_DISABLED", "public sign-up is closed", `status ${register.status}`);

  const forgot = await http("/api/auth/forgot", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `probe-${randomBytes(4).toString("hex")}@example.invalid` }) });
  check(forgot.status === 200 && forgot.json?.resetUrl === undefined, "password reset never returns the link", `status ${forgot.status}`);

  const supabaseUrl = arg("supabase-url")?.replace(/\/$/, "");
  const anonKey = arg("anon-key");
  if (supabaseUrl && anonKey) {
    console.log("\n== Supabase Data API with the public anon key");
    for (const table of ["users", "organizations", "authSessions", "platformStaff", "customers"]) {
      const response = await fetch(`${supabaseUrl}/rest/v1/${table}?select=id&limit=1`, { headers: { apikey: anonKey, authorization: `Bearer ${anonKey}` } });
      const body = await response.text();
      let rows = 0;
      try {
        const parsed = JSON.parse(body);
        rows = Array.isArray(parsed) ? parsed.length : 0;
      } catch {
        rows = 0;
      }
      check(rows === 0, `Data API returns no ${table} rows to the anon key`, `status ${response.status}, ${rows} row(s)`);
    }
    const bucket = await fetch(`${supabaseUrl}/storage/v1/object/public/staff-documents/probe`);
    check(bucket.status !== 200, "staff-documents bucket is not public", `status ${bucket.status}`);
  } else {
    record("WARN", "Supabase Data API check skipped", "pass --supabase-url and --anon-key to run it");
  }
}

async function loginToken(email: string, password: string) {
  const response = await http("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  if (response.status !== 200) throw new Error(`login failed for ${email}: ${response.status} ${response.text}`);
  return response.json.token as string;
}

async function completeSetup(setupUrl: string, password: string) {
  const token = decodeURIComponent(setupUrl.split("reset_token=")[1] ?? "");
  const response = await http("/api/auth/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, password }) });
  if (response.status !== 200) throw new Error(`setup failed: ${response.status} ${response.text}`);
  return response.json.token as string;
}

async function fullChecks() {
  console.log(`\n== Cross-tenant checks against ${baseUrl} (creates throwaway shops)`);
  const stamp = Date.now();
  const password = `probe-${randomBytes(6).toString("hex")}`;
  let operatorToken: string;
  if (flag("bootstrap")) {
    const email = `probe-operator-${stamp}@example.com`;
    const out = execFileSync("node", ["scripts/grant-platform-staff.mjs", "--email", email, "--name", "Probe Operator", "--role", "superadmin"], { encoding: "utf8", env: { ...process.env, AUTH_BASE_URL: baseUrl } });
    const link = out.match(/Setup link[^:]*: (\S+)/)?.[1];
    if (!link) throw new Error(`could not read the operator setup link:\n${out}`);
    operatorToken = await completeSetup(link, password);
  } else {
    const email = arg("operator-email");
    const operatorPassword = arg("operator-password");
    if (!email || !operatorPassword) throw new Error("full mode needs --bootstrap or --operator-email and --operator-password");
    operatorToken = await loginToken(email, operatorPassword);
  }

  const shops: Array<{ id: number; token: string; name: string }> = [];
  for (const tag of ["a", "b"]) {
    const created = await trpc("admin.organizations.create", "mutation", { shopName: `Probe Shop ${tag} ${stamp}`, ownerName: `Probe Owner ${tag}`, ownerEmail: `probe-${tag}-${stamp}@example.com` }, operatorToken);
    if (!created.data) throw new Error(`could not create shop ${tag}: ${created.message}`);
    const token = await completeSetup(created.data.setupUrl, password);
    shops.push({ id: created.data.organizationId, token, name: tag });
  }
  const [a, b] = shops as [(typeof shops)[number], (typeof shops)[number]];

  const customer = await trpc("erp.customers.create", "mutation", { name: "Probe Secret Customer", phone: "99990001", email: "", address: "", notes: "", preferredContact: "phone" }, a.token);
  check(Boolean(customer.data?.id), "shop A can create its own customer", customer.message ?? "");
  const item = await trpc("erp.inventory.create", "mutation", { code: `PRB-${stamp}`, name: "Probe Secret Fabric", inventoryType: "material", category: "fabric", color: "x", unit: "m", minThreshold: 0, costPerUnit: 1, salePrice: 2, openingQuantity: 5, rollCount: 0 }, a.token);

  const listB = await trpc("erp.customers.list", "query", { search: "Probe Secret" }, b.token);
  check(Array.isArray(listB.data) && listB.data.length === 0, "shop B cannot list shop A's customers");
  const hijack = await trpc("erp.customers.update", "mutation", { id: customer.data?.id, name: "Hijacked", phone: "1", email: "", address: "", notes: "", preferredContact: "phone" }, b.token);
  const listA = await trpc("erp.customers.list", "query", { search: "Probe Secret" }, a.token);
  check(Array.isArray(listA.data) && listA.data.some((row: any) => row.name === "Probe Secret Customer"), "shop A's customer is unchanged after shop B's update attempt", hijack.message ?? "");
  const leak = await trpc("erp.services.create", "mutation", { sku: `PRB-S-${stamp}`, name: "Leak", category: "fabric", description: "", unitPrice: 1, inventoryItemId: item.data?.id }, b.token);
  check(leak.status >= 400, "shop B cannot link a service to shop A's inventory item", `status ${leak.status}`);
  const catalogB = await trpc("pos.catalog.list", "query", undefined, b.token);
  check(!JSON.stringify(catalogB.data ?? "").includes("Probe Secret Fabric"), "shop B's catalog never shows shop A's stock");
  const asOperator = await trpc("erp.customers.list", "query", { search: "" }, operatorToken);
  check(asOperator.code !== undefined || Array.isArray(asOperator.data), "operator sessions reach the tenant API only as their own shop (no cross-tenant listing)");
  for (const path of ["admin.organizations.list", "admin.security.status"]) {
    const asShop = await trpc(path, "query", undefined, a.token);
    check(asShop.code === "FORBIDDEN", `a shop owner cannot call ${path}`, `got ${asShop.code}`);
  }

  for (const shop of shops) {
    await trpc("admin.organizations.suspend", "mutation", { organizationId: shop.id, reason: "security probe cleanup" }, operatorToken);
  }
  record("PASS", "throwaway shops suspended");
}

try {
  await readonlyChecks();
  if (mode === "full") await fullChecks();
} catch (error) {
  record("FAIL", "probe aborted", error instanceof Error ? error.message : String(error));
}
const failed = results.filter(r => r.level === "FAIL").length;
const warned = results.filter(r => r.level === "WARN").length;
console.log(`\n${results.length - failed - warned} passed, ${warned} warning(s), ${failed} failed`);
process.exit(failed ? 1 : 0);
