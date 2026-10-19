import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  customRoles,
  userBusinessRoles,
  userCustomRoles,
  type BusinessRole,
} from "../../drizzle/schema";
import { dbOrThrow, orgScope } from "./tenantDb";

export const customPermissionValues = [
  "dashboard",
  "customers",
  "sales",
  "inventory",
  "payroll",
  "production",
] as const;
export type CustomPermission = (typeof customPermissionValues)[number];

/**
 * The one permission that stands for each base role. A custom role gets into
 * a route only by holding a permission the route asks for; holding some other
 * permission that merely overlaps with a base role (a "dashboard" role is not
 * a "sales" role) is not enough.
 */
const primaryPermission: Record<Exclude<BusinessRole, "admin">, CustomPermission> = {
  sales: "sales",
  tailor: "production",
  inventory: "inventory",
  payroll: "payroll",
};

const listPermissions = new Map<readonly BusinessRole[], readonly CustomPermission[]>();

/** A route's allowed base roles, plus the custom-role permissions that open the same route. */
function roleList(roles: BusinessRole[], permissions: CustomPermission[]) {
  listPermissions.set(roles, permissions);
  return roles;
}

export const adminRoles = roleList(["admin"], []);
export const salesRoles = roleList(["admin", "sales"], ["sales"]);
export const catalogRoles = roleList(["admin", "sales", "inventory"], ["sales", "inventory"]);
export const inventoryRoles = roleList(["admin", "inventory"], ["inventory"]);
export const payrollRoles = roleList(["admin", "payroll"], ["payroll"]);
export const tailoringRoles = roleList(["admin", "sales", "tailor"], ["sales", "production"]);
export const staffDirectoryRoles = roleList(
  ["admin", "payroll", "sales", "tailor"],
  ["payroll", "sales", "production"]
);
export const dashboardRoles = roleList(
  ["admin", "sales", "inventory", "tailor", "payroll"],
  ["dashboard"]
);
export const customerReadRoles = roleList(["admin", "sales", "tailor"], ["customers", "sales"]);
export const customerWriteRoles = roleList(["admin", "sales"], ["customers", "sales"]);
export const measurementWriteRoles = roleList(["admin", "tailor", "sales"], ["customers", "production"]);

function requiredPermissions(allowed: readonly BusinessRole[]): readonly CustomPermission[] {
  return (
    listPermissions.get(allowed) ??
    allowed.filter(role => role !== "admin").map(role => primaryPermission[role as Exclude<BusinessRole, "admin">])
  );
}

export const customRoleCanAccess = (permissions: string[], allowed: readonly BusinessRole[]) =>
  requiredPermissions(allowed).some(permission => permissions.includes(permission));

/**
 * Decides whether a user may act within their own organization, and how:
 * "admin"/base role directly, or through an owner-assigned custom role.
 * Throws FORBIDDEN otherwise. Every lookup is scoped by organizationId.
 *
 * Membership is created atomically at organization creation or invite
 * acceptance, so a missing row is a real error. A placeholder row (created
 * for invited staff) grants nothing by itself: without an active custom-role
 * assignment it denies, so clearing the custom role really removes access.
 */
export async function resolveAccess(
  userId: number,
  organizationId: number,
  allowed: readonly BusinessRole[],
  options: { deniedMessage?: string } = {}
): Promise<{ via: "role" | "custom"; label: string }> {
  const db = await dbOrThrow();
  const record = (
    await db
      .select()
      .from(userBusinessRoles)
      .where(and(eq(userBusinessRoles.userId, userId), orgScope(userBusinessRoles, organizationId)))
      .limit(1)
  )[0];
  if (!record)
    throw new TRPCError({ code: "FORBIDDEN", message: "Your ERP access could not be verified." });
  if (!record.isActive)
    throw new TRPCError({ code: "FORBIDDEN", message: "Your ERP access is inactive." });
  if (record.role === "admin") return { via: "role", label: record.role };
  const assignment = (
    await db
      .select()
      .from(userCustomRoles)
      .where(and(eq(userCustomRoles.userId, userId), orgScope(userCustomRoles, organizationId)))
      .limit(1)
  )[0];
  if (assignment) {
    const role = (
      await db
        .select()
        .from(customRoles)
        .where(and(eq(customRoles.id, assignment.customRoleId), orgScope(customRoles, organizationId)))
        .limit(1)
    )[0];
    const permissions = Array.isArray(role?.permissionsJson)
      ? role.permissionsJson.filter((value): value is string => typeof value === "string")
      : [];
    if (!assignment.isActive || !role?.isActive || !customRoleCanAccess(permissions, allowed))
      throw new TRPCError({
        code: "FORBIDDEN",
        message: options.deniedMessage ?? "Your owner-assigned role is not permitted to perform this action.",
      });
    return { via: "custom", label: `custom:${role.name}` };
  }
  if (record.isPlaceholder)
    throw new TRPCError({ code: "FORBIDDEN", message: "No role has been assigned to your account yet." });
  if (allowed.includes(record.role)) return { via: "role", label: record.role };
  throw new TRPCError({
    code: "FORBIDDEN",
    message: options.deniedMessage ?? "Your assigned role is not permitted to perform this action.",
  });
}

/** True when resolveAccess would allow the action; used to tailor which fields a caller may see. */
export async function hasAccess(userId: number, organizationId: number, allowed: readonly BusinessRole[]) {
  try {
    await resolveAccess(userId, organizationId, allowed);
    return true;
  } catch (error) {
    if (error instanceof TRPCError) return false;
    throw error;
  }
}
