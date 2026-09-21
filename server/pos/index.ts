import { router } from "../_core/trpc";
export * from "./shared";
import { catalogRouter } from "./catalog";
import { sessionRouter } from "./session";
import { ordersRouter } from "./orders";
import { discountsRouter } from "./discounts";
import { checkoutProcedure, quickCheckoutProcedure } from "./checkout";
import { returnsRouter } from "./returns";
import { tailoringCheckoutProcedure } from "./tailoringCheckout";

export const posRouter = router({
  catalog: catalogRouter,
  session: sessionRouter,
  orders: ordersRouter,
  discounts: discountsRouter,
  checkout: checkoutProcedure,
  quickCheckout: quickCheckoutProcedure,
  returns: returnsRouter,
  tailoringCheckout: tailoringCheckoutProcedure,
});
