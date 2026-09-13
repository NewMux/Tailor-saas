import { useCallback, useEffect, useRef, useState } from "react";
import { initializePaddle, type Paddle } from "@paddle/paddle-js";
import {
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useLanguage } from "@/contexts/LanguageContext";
import { trpc } from "@/lib/trpc";

function formatDate(
  value: Date | string | null | undefined,
  isArabic: boolean
) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(isArabic ? "ar" : "en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Subscription screen. Doubles as the paywall: when `locked` is set the
 * surrounding chrome is replaced by a full-page lockout, but the subscribe
 * controls are identical, so there is only ever one checkout code path.
 */
export default function Billing({ locked = false }: { locked?: boolean }) {
  const { isArabic, t } = useLanguage();
  const utils = trpc.useUtils();
  const statusQuery = trpc.billing.status.useQuery(undefined, { retry: false });
  const configQuery = trpc.billing.config.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const checkoutQuery = trpc.billing.checkout.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
    enabled: configQuery.data?.configured === true,
  });
  const refreshMutation = trpc.billing.refresh.useMutation();
  const portalMutation = trpc.billing.portalSession.useMutation();

  const [paddle, setPaddle] = useState<Paddle | null>(null);
  const [openingCheckout, setOpeningCheckout] = useState(false);
  const completionHandled = useRef(false);

  const config = configQuery.data;
  const status = statusQuery.data;

  /** Pulls the subscription from Paddle, then refreshes what the UI shows. */
  const syncAfterCheckout = useCallback(async () => {
    try {
      await refreshMutation.mutateAsync();
    } catch {
      // The webhook is the authoritative path; this is only a fast-path.
    }
    await utils.billing.status.invalidate();
    await utils.invalidate();
  }, [refreshMutation, utils]);

  useEffect(() => {
    if (!config?.configured || !config.clientToken) return;
    let cancelled = false;

    void (async () => {
      try {
        const instance = await initializePaddle({
          token: config.clientToken,
          environment:
            config.environment === "production" ? "production" : "sandbox",
          eventCallback(event) {
            // Paddle fires this in the page that opened the overlay, so the
            // app can unlock immediately instead of waiting for the webhook.
            if (
              event.name === "checkout.completed" &&
              !completionHandled.current
            ) {
              completionHandled.current = true;
              toast.success(t("Subscription active. Thank you!"));
              void syncAfterCheckout();
            }
          },
        });
        if (!cancelled && instance) setPaddle(instance);
      } catch {
        if (!cancelled)
          toast.error(
            t("Could not load the payment form. Please refresh and try again.")
          );
      }
    })();

    return () => {
      cancelled = true;
    };
    // syncAfterCheckout/t are stable enough for this one-time setup; re-running
    // it would tear down and rebuild the Paddle instance on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.configured, config?.clientToken, config?.environment]);

  const openCheckout = () => {
    const checkout = checkoutQuery.data;
    if (!paddle || !checkout?.priceId) {
      toast.error(
        t("The payment form is still loading. Please try again in a moment.")
      );
      return;
    }
    setOpeningCheckout(true);
    completionHandled.current = false;
    try {
      paddle.Checkout.open({
        items: [{ priceId: checkout.priceId, quantity: 1 }],
        // customData is what lets the Paddle webhook match the resulting
        // subscription back to this organization.
        customData: { organizationId: checkout.organizationId },
        ...(checkout.paddleCustomerId
          ? { customer: { id: checkout.paddleCustomerId } }
          : checkout.customerEmail
            ? { customer: { email: checkout.customerEmail } }
            : {}),
        settings: {
          displayMode: "overlay",
          theme: "light",
          locale: isArabic ? "ar" : "en",
          successUrl: `${window.location.origin}/billing?checkout=complete`,
        },
      });
    } catch {
      toast.error(t("Could not open the payment form. Please try again."));
    } finally {
      setOpeningCheckout(false);
    }
  };

  const openPortal = async () => {
    try {
      const session = await portalMutation.mutateAsync();
      window.open(session.overviewUrl, "_blank", "noopener,noreferrer");
    } catch {
      toast.error(t("Could not open the billing portal. Please try again."));
    }
  };

  // Returning from Paddle's hosted success page: sync before showing status.
  useEffect(() => {
    if (
      new URLSearchParams(window.location.search).get("checkout") !== "complete"
    )
      return;
    window.history.replaceState(null, document.title, window.location.pathname);
    void syncAfterCheckout();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (statusQuery.isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const access = status?.access;
  const trialEnds = formatDate(status?.trialEndsAt, isArabic);
  const periodEnds = formatDate(status?.currentPeriodEndsAt, isArabic);
  const billingDisabled = config?.configured === false;

  const statusBanner = () => {
    if (billingDisabled) {
      return (
        <div className="flex items-start gap-3 rounded-xl border border-stone-200 bg-stone-50 p-4">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-stone-500" />
          <div>
            <p className="font-medium">
              {t("Billing is not set up on this deployment")}
            </p>
            <p className="text-sm text-muted-foreground">
              {t(
                "Your workspace is fully unlocked. No subscription is required."
              )}
            </p>
          </div>
        </div>
      );
    }
    if (!access) return null;

    if (access.reason === "trialing") {
      return (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          <div>
            <p className="font-medium text-emerald-900">
              {access.daysRemaining} {t("days left in your free trial")}
            </p>
            {trialEnds && (
              <p className="text-sm text-emerald-800">
                {t("Your trial ends on")} {trialEnds}.
              </p>
            )}
          </div>
        </div>
      );
    }
    if (access.reason === "subscribed") {
      return (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          <div>
            <p className="font-medium text-emerald-900">
              {t("Your subscription is active")}
            </p>
            {periodEnds && (
              <p className="text-sm text-emerald-800">
                {t("Next renewal on")} {periodEnds}.
              </p>
            )}
          </div>
        </div>
      );
    }
    if (access.reason === "grace_period") {
      return (
        <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <p className="font-medium text-amber-900">
              {t("Your last payment did not go through")}
            </p>
            <p className="text-sm text-amber-800">
              {t("Update your payment method within")} {access.daysRemaining}{" "}
              {t("days to avoid losing access.")}
            </p>
          </div>
        </div>
      );
    }
    return (
      <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
        <div>
          <p className="font-medium text-red-900">
            {t("Your workspace is locked")}
          </p>
          <p className="text-sm text-red-800">
            {t("Subscribe below to restore access to your shop data.")}
          </p>
        </div>
      </div>
    );
  };

  const body = (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            {t("Subscription")}
          </CardTitle>
          <CardDescription>
            {status?.organizationName ? `${status.organizationName} — ` : ""}
            {t("Manage the subscription for your shop.")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {statusBanner()}

          {!billingDisabled && (
            <div className="flex flex-col gap-3 sm:flex-row">
              {access?.reason !== "subscribed" && (
                <Button
                  onClick={openCheckout}
                  disabled={openingCheckout || !paddle}
                  className="gap-2"
                >
                  {openingCheckout || !paddle ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CreditCard className="h-4 w-4" />
                  )}
                  {status?.hasSubscription
                    ? t("Update subscription")
                    : t("Subscribe now")}
                </Button>
              )}
              {status?.hasSubscription && (
                <Button
                  variant="outline"
                  onClick={() => void openPortal()}
                  disabled={portalMutation.isPending}
                  className="gap-2"
                >
                  {portalMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ExternalLink className="h-4 w-4" />
                  )}
                  {t("Manage billing")}
                </Button>
              )}
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            {t(
              "Payments are processed securely by Paddle, our authorised reseller. Prices are shown in your local currency where available."
            )}
          </p>
        </CardContent>
      </Card>
    </div>
  );

  if (!locked) return body;

  return (
    <div
      className="min-h-[100dvh] bg-stone-50 px-4 py-12"
      dir={isArabic ? "rtl" : "ltr"}
    >
      {body}
    </div>
  );
}
