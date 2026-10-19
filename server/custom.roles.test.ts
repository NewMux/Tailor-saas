import { describe, expect, it } from "vitest";
import { customRoleCanAccess } from "./erp";

describe("owner-managed role permissions", () => {
  it("allows only the operational areas selected by the owner", () => {
    expect(customRoleCanAccess(["sales", "customers"], ["sales"])).toBe(true);
    expect(customRoleCanAccess(["sales", "customers"], ["inventory"])).toBe(false);
    expect(customRoleCanAccess(["payroll"], ["payroll"])).toBe(true);
  });

  it("requires the sales permission for a custom counter role", () => {
    expect(customRoleCanAccess(["sales"], ["sales"])).toBe(true);
    expect(customRoleCanAccess(["inventory"], ["sales"])).toBe(false);
  });

  it("does not let a dashboard-only role into inventory routes", () => {
    expect(customRoleCanAccess(["dashboard"], ["admin", "inventory"])).toBe(false);
  });

  it("allows inventory and sales roles to view the shared POS catalog", () => {
    expect(customRoleCanAccess(["inventory"], ["admin", "sales", "inventory"])).toBe(true);
    expect(customRoleCanAccess(["sales"], ["admin", "sales", "inventory"])).toBe(true);
    expect(customRoleCanAccess(["payroll"], ["admin", "sales", "inventory"])).toBe(false);
  });

  it("does not let a dashboard-only role into payroll routes", () => {
    expect(customRoleCanAccess(["dashboard"], ["admin", "payroll"])).toBe(false);
  });
});

describe("custom roles only get what their permissions name", () => {
  const can = (permissions: string[], list: Parameters<typeof customRoleCanAccess>[1]) => customRoleCanAccess(permissions, list);

  it("does not let a dashboard-only or customers-only role into sales routes", async () => {
    const { salesRoles } = await import("./erp/shared");
    expect(can(["dashboard"], salesRoles)).toBe(false);
    expect(can(["customers"], salesRoles)).toBe(false);
    expect(can(["sales"], salesRoles)).toBe(true);
  });

  it("does not let a dashboard-only role into tailoring or the staff directory", async () => {
    const { tailoringRoles, staffDirectoryRoles } = await import("./erp/shared");
    expect(can(["dashboard"], tailoringRoles)).toBe(false);
    expect(can(["customers"], tailoringRoles)).toBe(false);
    expect(can(["production"], tailoringRoles)).toBe(true);
    expect(can(["dashboard"], staffDirectoryRoles)).toBe(false);
    expect(can(["customers"], staffDirectoryRoles)).toBe(false);
  });

  it("opens the dashboard only to roles with the dashboard permission", async () => {
    const { dashboardRoles } = await import("./erp/shared");
    expect(can(["dashboard"], dashboardRoles)).toBe(true);
    expect(can(["inventory"], dashboardRoles)).toBe(false);
    expect(can(["sales"], dashboardRoles)).toBe(false);
  });

  it("lets a customers-only role read and edit customers but not delete them", async () => {
    const { customerReadRoles, customerWriteRoles, salesRoles, measurementWriteRoles } = await import("./erp/shared");
    expect(can(["customers"], customerReadRoles)).toBe(true);
    expect(can(["customers"], customerWriteRoles)).toBe(true);
    expect(can(["customers"], measurementWriteRoles)).toBe(true);
    expect(can(["customers"], salesRoles)).toBe(false);
    expect(can(["dashboard"], customerReadRoles)).toBe(false);
  });

  it("treats an unregistered ad-hoc list strictly, by each role's own permission", () => {
    expect(can(["dashboard"], ["admin", "sales", "tailor"])).toBe(false);
    expect(can(["production"], ["admin", "sales", "tailor"])).toBe(true);
  });
});
