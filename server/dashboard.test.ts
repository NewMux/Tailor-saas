import { describe, expect, it } from "vitest";
import { getCustomDashboardRange, getDashboardRangeStart } from "./erp";

describe("owner dashboard date filters", () => {
  const now = new Date("2026-08-14T14:30:00.000Z");

  it("anchors the today filter to the start of the current day", () => {
    expect(getDashboardRangeStart("today", now)?.toISOString()).toBe("2026-08-14T00:00:00.000Z");
  });

  it("builds inclusive rolling windows and preserves all-time access", () => {
    expect(getDashboardRangeStart("7d", now)?.toISOString()).toBe("2026-08-08T00:00:00.000Z");
    expect(getDashboardRangeStart("30d", now)?.toISOString()).toBe("2026-07-16T00:00:00.000Z");
    expect(getDashboardRangeStart("90d", now)?.toISOString()).toBe("2026-05-17T00:00:00.000Z");
    expect(getDashboardRangeStart("all", now)).toBeNull();
  });

  it("creates inclusive bounds for an owner-selected custom period", () => {
    const range = getCustomDashboardRange("2026-08-01", "2026-08-14");
    expect(range.start.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-08-14T23:59:59.999Z");
  });
});
