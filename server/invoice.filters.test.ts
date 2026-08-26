import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocked.getDb }));

import { appRouter } from "./routers";

const query = (rows: unknown[]) => ({
  from: () => ({
    where: () => ({ limit: () => rows }),
    orderBy: () => ({ limit: () => rows }),
    limit: () => rows,
  }),
});

describe("erp.invoices.list", () => {
  beforeEach(() => vi.clearAllMocks());

  it("filters populated invoice rows by invoice, sale, payment, status, and date fields", async () => {
    const matchingIssuedAt = new Date("2026-08-14T10:00:00.000Z");
    const outsideDateRange = new Date("2026-09-01T10:00:00.000Z");
    const responses = [
      [{ userId: 1, role: "admin", isActive: true }],
      [
        { id: 1, saleId: 101, invoiceNumber: "POS-000101", status: "paid", issuedAt: matchingIssuedAt },
        { id: 2, saleId: 102, invoiceNumber: "POS-000102", status: "paid", issuedAt: outsideDateRange },
      ],
      [
        { id: 101, saleNumber: "SALE-101", source: "counter", paymentMethod: "cash", customerNameSnapshot: "Ahmed Hassan", customerPhoneSnapshot: "+973 3000 0001", createdAt: matchingIssuedAt },
        { id: 102, saleNumber: "SALE-102", source: "manual", paymentMethod: "cash", customerNameSnapshot: "Other Customer", customerPhoneSnapshot: "+973 3000 0002", createdAt: outsideDateRange },
      ],
    ];
    mocked.getDb.mockResolvedValue({ select: vi.fn(() => query(responses.shift() || [])) });
    const caller = appRouter.createCaller({ user: { id: 1, role: "admin" } } as never);

    const result = await caller.erp.invoices.list({ search: "ahmed", status: "paid", source: "counter", paymentMethod: "cash", startDate: "2026-08-01", endDate: "2026-08-31" });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 1, invoiceNumber: "POS-000101", sale: { id: 101, saleNumber: "SALE-101", customerNameSnapshot: "Ahmed Hassan" } });
  });
});
