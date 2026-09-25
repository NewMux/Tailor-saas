import { useEffect, useRef, useState } from "react";
import { CheckCircle2, CreditCard, ExternalLink, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { openPaddleCheckout } from "@/lib/paddle";
import { formatPlanPrice } from "@/lib/formatPlanPrice";
import { useLanguage } from "@/contexts/LanguageContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const STATUS_COPY: Record<string, { label: string; tone: "default" | "secondary" | "destructive" | "outline" }> = {
  trialing: { label: "Free trial", tone: "secondary" },
  trial_expired: { label: "Trial ended", tone: "destructive" },
  active: { label: "Active", tone: "default" },
  past_due: { label: "Payment failed", tone: "destructive" },
  paused: { label: "Paused", tone: "destructive" },
  canceled: { label: "Canceled", tone: "destructive" },
  exempt: { label: "Complimentary", tone: "secondary" },
  billing_disabled: { label: "Not required", tone: "outline" },
};

function formatDate(value: Date | string | null | undefined, locale: string) {
  if (!value) return null;
  return new Date(value).toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" });
}

export default function Billing() {
  const { isArabic } = useLanguage();
  const locale = isArabic ? "ar" : "en";
  const utils = trpc.useUtils();
  const status = trpc.erp.billing.status.useQuery();
  const [waitingForActivation, setWaitingForActivation] = useState(false);
  const pollTimer = useRef<number | null>(null);

  const checkout = trpc.erp.billing.checkoutConfig.useMutation({ onError: error => toast.error(error.message) });
  const portal = trpc.erp.billing.portalUrl.useMutation({
    onSuccess: ({ url }) => window.open(url, "_blank", "noopener,noreferrer"),
    onError: error => toast.error(error.message),
  });

  // The subscription is activated by Paddle's webhook, which can land a few
  // seconds after the checkout overlay reports success, so poll briefly.
  useEffect(() => {
    if (!waitingForActivation) return;
    const startedAt = Date.now();
    pollTimer.current = window.setInterval(async () => {
      const latest = await utils.erp.billing.status.fetch();
      if (latest.subscriptionStatus === "active" || Date.now() - startedAt > 60_000) {
        setWaitingForActivation(false);
        window.dispatchEvent(new Event("billing-status-changed"));
        if (latest.subscriptionStatus === "active") toast.success("Subscription active. Thank you!");
      }
    }, 2500);
    return () => {
      if (pollTimer.current) window.clearInterval(pollTimer.current);
    };
  }, [waitingForActivation, utils]);

  const subscribe = async () => {
    try {
      const config = await checkout.mutateAsync();
      await openPaddleCheckout({
        ...config,
        locale,
        onEvent: event => {
          if (event.name === "checkout.completed") setWaitingForActivation(true);
        },
      });
    } catch (error) {
      if (error instanceof Error && !checkout.isError) toast.error(error.message);
    }
  };

  if (status.isLoading) return <div className="flex min-h-[280px] items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading billing…</div>;
  if (status.error || !status.data) return <p className="text-destructive">{status.error?.message ?? "Billing is unavailable."}</p>;

  const data = status.data;
  const copy = STATUS_COPY[data.reason] ?? { label: data.reason, tone: "outline" as const };
  const price = data.price ? formatPlanPrice(data.price, locale) : null;
  const isPaying = data.subscriptionStatus === "active";

  if (!data.billingEnabled) {
    return <div className="mx-auto max-w-3xl"><Card><CardHeader><CardTitle>Billing</CardTitle><CardDescription>Billing is not enabled for this workspace. There is nothing to pay.</CardDescription></CardHeader></Card></div>;
  }

  return <div className="mx-auto max-w-3xl space-y-6">
    <div>
      <p className="text-xs font-bold uppercase tracking-[.16em] text-primary">Subscription</p>
      <h1 className="mt-2 text-3xl font-semibold">Billing</h1>
      <p className="mt-2 text-sm text-muted-foreground">Manage your plan, payment method and invoices.</p>
    </div>

    {data.access === "read_only" && <div role="alert" className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <p>{data.reason === "past_due" ? "Your last payment failed. Update your payment method to restore full access." : "Your shop is read-only. You can still view and export your data; subscribe to keep recording sales and orders."}</p>
    </div>}

    <Card>
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base"><CreditCard className="h-4 w-4 text-primary" />Your plan</CardTitle>
          <Badge variant={copy.tone}>{copy.label}</Badge>
        </div>
        {price && <CardDescription><span className="numeric text-2xl font-semibold text-foreground" data-no-translate>{price.amount}</span> <span>per {price.period}</span></CardDescription>}
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {data.subscriptionStatus === "trialing" && data.trialEndsAt && <div className="rounded-lg border p-3"><dt className="text-muted-foreground">{data.access === "full" ? "Trial ends" : "Trial ended"}</dt><dd className="mt-1 font-medium" data-no-translate>{formatDate(data.trialEndsAt, locale)}</dd></div>}
          {data.trialDaysLeft !== null && data.access === "full" && <div className="rounded-lg border p-3"><dt className="text-muted-foreground">Days left in trial</dt><dd className="numeric mt-1 font-medium">{data.trialDaysLeft}</dd></div>}
          {isPaying && data.currentPeriodEndsAt && <div className="rounded-lg border p-3"><dt className="text-muted-foreground">Next renewal</dt><dd className="mt-1 font-medium" data-no-translate>{formatDate(data.currentPeriodEndsAt, locale)}</dd></div>}
        </dl>

        {waitingForActivation && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Confirming your payment…</p>}

        {!data.canManage ? <p className="text-sm text-muted-foreground">Only the shop owner can change billing.</p> : data.billingExempt ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-emerald-600" />Your workspace is complimentary. No payment is needed.</p> : <div className="flex flex-col gap-2 sm:flex-row">
          {!isPaying && <Button className="h-11" onClick={() => void subscribe()} disabled={checkout.isPending || waitingForActivation}>{checkout.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Subscribe now</Button>}
          {data.hasSubscription && <Button variant="outline" className="h-11" onClick={() => portal.mutate()} disabled={portal.isPending}>{portal.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ExternalLink className="mr-2 h-4 w-4" />}Manage billing</Button>}
        </div>}
        {data.hasSubscription && data.canManage && <p className="text-xs text-muted-foreground">Update your card, download invoices or cancel from the secure billing portal. Payments are processed by Paddle, our reseller and merchant of record.</p>}
      </CardContent>
    </Card>
  </div>;
}
