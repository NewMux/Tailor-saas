import { useState } from "react";
import { AlertCircle } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { clientBrand } from "@/lib/branding";
import { Button } from "@/components/ui/button";

export default function OrganizationSuspended({ onSignOut }: { onSignOut: () => Promise<void> | void }) {
  const { t } = useLanguage();
  const [signingOut, setSigningOut] = useState(false);

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-stone-50 p-4">
      <div className="w-full max-w-sm rounded-2xl border bg-white p-6 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
          <AlertCircle className="h-6 w-6 text-red-600" />
        </div>
        <p className="mt-4 text-sm font-semibold text-muted-foreground">{clientBrand.name}</p>
        <h1 className="mt-1 text-lg font-semibold">{t("This organization has been suspended")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("Access to this workspace has been suspended. Contact support for help restoring it.")}
        </p>
        <Button
          className="mt-6 w-full"
          disabled={signingOut}
          onClick={async () => {
            setSigningOut(true);
            try {
              await onSignOut();
            } finally {
              setSigningOut(false);
            }
          }}
        >
          {t("Sign out")}
        </Button>
      </div>
    </div>
  );
}
