import { useEffect } from "react";
import { AlertTriangle, Clock } from "lucide-react";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";

/**
 * In-flow (not fixed) notice above page content: trial ending soon, or the
 * shop being read-only for non-payment. Hidden on the billing page itself.
 */
export default function BillingBanner() {
  const [location] = useLocation();
  const status = trpc.erp.billing.status.useQuery(undefined, { staleTime: 5 * 60 * 1000, refetchOnWindowFocus: true });
  const { refetch } = status;

  useEffect(() => {
    const onChange = () => void refetch();
    window.addEventListener("billing-status-changed", onChange);
    return () => window.removeEventListener("billing-status-changed", onChange);
  }, [refetch]);

  const data = status.data;
  if (!data?.billingEnabled || location === "/billing") return null;

  if (data.access === "read_only") {
    return <div role="alert" className="mb-4 flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900 sm:flex-row sm:items-center sm:justify-between">
      <p className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{data.reason === "past_due" ? "Your last payment failed. Your shop is read-only until the payment method is updated." : "Your shop is read-only. You can view and export data, but new sales and orders need an active subscription."}</span></p>
      {data.canManage && <Link href="/billing" className="shrink-0 rounded-lg bg-red-900 px-3 py-2 text-center text-xs font-semibold text-white hover:bg-red-800">Go to billing</Link>}
    </div>;
  }

  if (data.reason === "trialing" && data.trialDaysLeft !== null && data.trialDaysLeft <= 7) {
    return <div className="mb-4 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between">
      <p className="flex items-start gap-2"><Clock className="mt-0.5 h-4 w-4 shrink-0" /><span>{data.trialDaysLeft <= 1 ? "Your free trial ends today." : `Your free trial ends in ${data.trialDaysLeft} days.`}</span></p>
      {data.canManage && <Link href="/billing" className="shrink-0 rounded-lg bg-amber-900 px-3 py-2 text-center text-xs font-semibold text-white hover:bg-amber-800">Subscribe</Link>}
    </div>;
  }

  return null;
}
