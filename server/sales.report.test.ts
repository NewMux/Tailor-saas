import { describe, expect, it } from "vitest";
import { buildBrandedMonthlySalesCsv } from "../client/src/lib/salesReportCsv";

describe("branded monthly sales CSV", () => {
  it("includes shop branding, report totals, and quoted transaction fields for Excel", () => {
    const csv = buildBrandedMonthlySalesCsv({
      shopName: "Al-Mamlaka Tailor ERP",
      arabicShopName: "المملكة للخياطة",
      month: "2026-08",
      revenue: 20,
      saleCount: 1,
      sales: [{ saleNumber: "MAN-100", customerNameSnapshot: "Walk-in, customer", customerPhoneSnapshot: null, source: "manual", paymentMethod: "cash", paymentStatus: "paid", total: "20.000", createdAt: new Date("2026-08-14T10:00:00.000Z"), invoice: { invoiceNumber: "INV-000100" } }],
    });
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"Al-Mamlaka Tailor ERP"');
    expect(csv).toContain('"Monthly Sales Report","2026-08"');
    expect(csv).toContain('"Walk-in, customer"');
    expect(csv).toContain('"INV-000100"');
  });
});
