export type PlanPrice = { amount: number; currency: string; interval: string; frequency: number };

/** Paddle amounts are in the currency's minor unit (cents, fils, ...). */
export function formatPlanPrice(price: PlanPrice, locale?: string) {
  const formatter = new Intl.NumberFormat(locale, { style: "currency", currency: price.currency });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  const amount = formatter.format(price.amount / 10 ** digits);
  const period = price.frequency === 1 ? price.interval : `${price.frequency} ${price.interval}s`;
  return { amount, period };
}
