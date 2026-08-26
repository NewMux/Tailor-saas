import { describe, expect, it } from "vitest";
import { makeCustomerSearchInput, matchesInventorySearch } from "../client/src/lib/operationsSearch";

describe("operations search helpers", () => {
  it("normalizes a client-directory search before it reaches the API", () => {
    expect(makeCustomerSearchInput("  3330 0011  ")).toEqual({ search: "3330 0011" });
  });

  it("finds inventory records by code, material details, and unit", () => {
    const item = { code: "FAB-NAVY-01", name: "Navy Premium Cotton", category: "fabric", color: "Navy", unit: "Meters" };
    expect(matchesInventorySearch(item, "navy")).toBe(true);
    expect(matchesInventorySearch(item, "fab-navy")).toBe(true);
    expect(matchesInventorySearch(item, "meters")).toBe(true);
    expect(matchesInventorySearch(item, "gold buttons")).toBe(false);
  });
});
