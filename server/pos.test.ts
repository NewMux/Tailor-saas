import { describe, expect, it } from "vitest";
import { calculateCheckoutTotal, returnItemSelection } from "./pos";

describe("POS checkout totals", () => {
  it("calculates a multi-line checkout after a fixed discount", () => {
    expect(calculateCheckoutTotal([{ quantity: 1, unitPrice: 45 }, { quantity: 2, unitPrice: 8 }], 5)).toEqual({ subtotal: 61, total: 56 });
  });

  it("never produces a negative total when an excessive discount is entered", () => {
    expect(calculateCheckoutTotal([{ quantity: 1, unitPrice: 12 }], 99)).toEqual({ subtotal: 12, total: 0 });
  });

  it("applies line discounts before the order-level discount", () => {
    expect(calculateCheckoutTotal([{ quantity: 2, unitPrice: 20, lineDiscount: 3 }], 2)).toEqual({ subtotal: 40, total: 35 });
  });

  it("caps an excessive line discount at its line subtotal", () => {
    expect(calculateCheckoutTotal([{ quantity: 1, unitPrice: 8, lineDiscount: 20 }], 0)).toEqual({ subtotal: 8, total: 0 });
  });

  it("accepts one selected return item", () => {
    expect(returnItemSelection.safeParse([{ saleItemId: 42, quantity: 1 }]).success).toBe(true);
  });

  it("rejects a return payload containing multiple selected items", () => {
    expect(returnItemSelection.safeParse([{ saleItemId: 42, quantity: 1 }, { saleItemId: 43, quantity: 1 }]).success).toBe(false);
  });
});
