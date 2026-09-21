import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";

export default function PlatformAuditFeed() {
  const feed = trpc.admin.auditFeed.useQuery();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Audit feed</h1>
        <p className="text-sm text-muted-foreground">Suspensions, reactivations, and impersonation events across every organization.</p>
      </div>
      {feed.isLoading ? (
        <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
      ) : (
        <div className="divide-y overflow-hidden rounded-xl border bg-white">
          {feed.data?.length ? feed.data.map(log => (
            <div key={log.id} className="px-4 py-3 text-sm">
              <p className="font-medium">{log.action}</p>
              <p className="text-xs text-muted-foreground">
                {new Date(log.createdAt).toLocaleString()} · org #{log.organizationId} · {log.entityType}{log.entityId ? ` #${log.entityId}` : ""}
              </p>
            </div>
          )) : <p className="px-4 py-6 text-sm text-muted-foreground">No platform events yet.</p>}
        </div>
      )}
    </div>
  );
}
