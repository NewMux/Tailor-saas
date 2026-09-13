import { Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import Billing from "@/pages/Billing";
import { useLanguage } from "@/contexts/LanguageContext";
import { trpc } from "@/lib/trpc";

/**
 * Replaces the whole workspace with the subscription screen when the
 * organization's trial or subscription has lapsed.
 *
 * This is a UX convenience, not the security boundary: the real enforcement
 * is requireActiveSubscription in server/_core/trpc.ts, which fails every
 * tenant-scoped request with HTTP 402 regardless of what the browser renders.
 */
export default function BillingGate({
  children,
  onSignOut,
}: {
  children: React.ReactNode;
  onSignOut: () => void;
}) {
  const { t } = useLanguage();
  const statusQuery = trpc.billing.status.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: true,
    // Re-check periodically so a lockout that begins mid-session is noticed
    // without the user having to reload the page.
    refetchInterval: 5 * 60 * 1000,
  });

  if (statusQuery.isLoading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  // If the status check itself fails, let the app through rather than locking
  // a paying shop out over a transient error. The server still refuses every
  // tenant request if the subscription really has lapsed.
  if (statusQuery.isError || statusQuery.data?.access.allowed !== false) {
    return <>{children}</>;
  }

  return (
    <div className="relative">
      <Billing locked />
      <div className="mx-auto mt-6 max-w-2xl px-4 text-center">
        <Button variant="ghost" size="sm" onClick={onSignOut} className="gap-2">
          <LogOut className="h-4 w-4" />
          {t("Sign out")}
        </Button>
      </div>
    </div>
  );
}
