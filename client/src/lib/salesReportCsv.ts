type MonthlySale = {
  saleNumber: string;
  customerNameSnapshot: string;
  customerPhoneSnapshot: string | null;
  source: string;
  paymentMethod: string;
  paymentStatus: string;
  total: string;
  createdAt: Date | string;
  invoice: { invoiceNumber: string } | null;
};

const escapeCsv = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;

export function buildBrandedMonthlySalesCsv(input: { shopName: string; arabicShopName?: string | null; month: string; revenue: number; saleCount: number; sales: MonthlySale[] }) {
  const exportedAt = new Date().toLocaleString();
  const rows = [
    [input.shopName],
    [input.arabicShopName || ""],
    ["Monthly Sales Report", input.month],
    ["Generated", exportedAt],
    ["Recorded revenue (BHD)", input.revenue.toFixed(3)],
    ["Number of sales", input.saleCount],
    [],
    ["Invoice", "Sale reference", "Date", "Customer", "Phone", "Source", "Payment method", "Payment status", "Amount (BHD)"],
    ...input.sales.map(sale => [sale.invoice?.invoiceNumber || "Pending", sale.saleNumber, new Date(sale.createdAt).toLocaleString(), sale.customerNameSnapshot, sale.customerPhoneSnapshot || "", sale.source, sale.paymentMethod.replace("_", " "), sale.paymentStatus, Number(sale.total).toFixed(3)]),
  ];
  return `\uFEFF${rows.map(row => row.map(escapeCsv).join(",")).join("\r\n")}`;
}

export function downloadBrandedMonthlySalesCsv(input: Parameters<typeof buildBrandedMonthlySalesCsv>[0]) {
  const blob = new Blob([buildBrandedMonthlySalesCsv(input)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${input.shopName.replace(/[^a-z0-9]+/gi, "-").replace(/(^-|-$)/g, "").toLowerCase() || "tailor-erp"}-sales-${input.month}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
