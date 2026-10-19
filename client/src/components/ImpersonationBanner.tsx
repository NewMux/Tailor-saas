import { useState } from "react";
import { authApi } from "@/lib/auth";
import { trpc } from "@/lib/trpc";
import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";

export default function ImpersonationBanner({ startedBy, mode = "readonly" }: { startedBy: string; mode?: "readonly" | "write" }) {
  const { t } = useLanguage();
  const utils = trpc.useUtils();
  const endMutation = trpc.admin.impersonation.end.useMutation();
  const [exiting, setExiting] = useState(false);

  const handleExit = async () => {
    setExiting(true);
    try {
      await endMutation.mutateAsync();
    } catch {
      // Restore the staff member's own session locally either way - a
      // failed server-side end (e.g. the session already expired) should
      // never leave them stuck looking at someone else's workspace.
    } finally {
      authApi.endImpersonation();
      await utils.auth.me.invalidate();
      setExiting(false);
    }
  };

  return (
    <div className="fixed inset-x-0 top-0 z-50 flex flex-wrap items-center justify-center gap-3 bg-amber-500 px-4 py-2 text-center text-sm font-medium text-amber-950">
      <span>{t("Viewing as another user")} · {startedBy} · {mode === "write" ? "Write access" : "Read-only"}</span>
      <Button size="sm" variant="outline" className="h-7 border-amber-950/30 bg-white/90 hover:bg-white" disabled={exiting} onClick={handleExit}>
        {t("Exit impersonation")}
      </Button>
    </div>
  );
}
