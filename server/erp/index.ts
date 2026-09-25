import { router } from "../_core/trpc";
export { rollDerivedQuantity } from "../inventoryQuantity";
export * from "./shared";
import { shopRouter } from "./shop";
import { dashboardProcedure } from "./dashboard";
import { customersRouter } from "./customers";
import { inventoryRouter } from "./inventory";
import { servicesRouter } from "./services";
import { salesRouter, salesHistoryRouter } from "./sales";
import { invoicesRouter } from "./invoices";
import { staffRouter } from "./staff";
import { tailoringRouter } from "./tailoring";
import { teamRouter, accessRouter, accessApprovalRouter } from "./team";
import { auditProcedure } from "./audit";
import { billingRouter } from "./billing";

export const erpRouter = router({
  shop: shopRouter,
  dashboard: dashboardProcedure,
  customers: customersRouter,
  inventory: inventoryRouter,
  services: servicesRouter,
  sales: salesRouter,
  salesHistory: salesHistoryRouter,
  invoices: invoicesRouter,
  staff: staffRouter,
  tailoring: tailoringRouter,
  team: teamRouter,
  access: accessRouter,
  accessApproval: accessApprovalRouter,
  audit: auditProcedure,
  billing: billingRouter,
});
