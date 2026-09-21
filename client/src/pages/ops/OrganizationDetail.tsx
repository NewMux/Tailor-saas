import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useLocation, useParams } from "wouter";
import { authApi } from "@/lib/auth";
import { trpc } from "@/lib/trpc";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

export default function OrganizationDetail() {
  const { id } = useParams<{ id: string }>();
  const organizationId = Number(id);
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const detail = trpc.admin.organizations.detail.useQuery({ organizationId }, { enabled: Number.isFinite(organizationId) });

  const [suspendDialogOpen, setSuspendDialogOpen] = useState(false);
  const [suspendReason, setSuspendReason] = useState("");
  const [impersonateReason, setImpersonateReason] = useState("");
  const [impersonatingUserId, setImpersonatingUserId] = useState<number | null>(null);

  const suspend = trpc.admin.organizations.suspend.useMutation({
    onSuccess: () => {
      utils.admin.organizations.detail.invalidate({ organizationId });
      utils.admin.organizations.list.invalidate();
      setSuspendReason("");
      setSuspendDialogOpen(false);
      toast.success("Organization suspended");
    },
    onError: error => toast.error(error.message),
  });
  const reactivate = trpc.admin.organizations.reactivate.useMutation({
    onSuccess: () => {
      utils.admin.organizations.detail.invalidate({ organizationId });
      utils.admin.organizations.list.invalidate();
      toast.success("Organization reactivated");
    },
    onError: error => toast.error(error.message),
  });
  const startImpersonation = trpc.admin.impersonation.start.useMutation({
    onSuccess: result => {
      authApi.beginImpersonation(result.token);
      toast.success(`Now viewing as ${result.target.name || result.target.email}`);
      navigate("/");
    },
    onError: error => toast.error(error.message),
  });

  if (!Number.isFinite(organizationId)) return <p className="text-sm text-muted-foreground">Invalid organization.</p>;
  if (detail.isLoading) return <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  if (!detail.data) return <p className="text-sm text-muted-foreground">Organization not found.</p>;

  const { organization, users, recentAuditLogs, planStatus } = detail.data;
  const isSuspended = organization.status === "suspended";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{organization.name}</h1>
          <p className="text-sm text-muted-foreground">{organization.slug}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={isSuspended ? "destructive" : "secondary"}>{organization.status}</Badge>
          <Badge variant="outline">{planStatus}</Badge>
        </div>
      </div>

      <div className="rounded-xl border bg-white p-4">
        {isSuspended ? (
          <Button disabled={reactivate.isPending} onClick={() => reactivate.mutate({ organizationId })}>Reactivate organization</Button>
        ) : (
          <AlertDialog open={suspendDialogOpen} onOpenChange={open => { setSuspendDialogOpen(open); if (!open) setSuspendReason(""); }}>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">Suspend organization</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Suspend {organization.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This immediately blocks every user in this organization and ends any open sessions. Provide a reason for the audit trail.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <Textarea value={suspendReason} onChange={event => setSuspendReason(event.target.value)} placeholder="Reason (required)" maxLength={500} />
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={suspendReason.trim().length < 3 || suspend.isPending}
                  onClick={() => suspend.mutate({ organizationId, reason: suspendReason.trim() })}
                >
                  Suspend
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border bg-white">
        <div className="border-b px-4 py-3"><h2 className="text-sm font-semibold">Users</h2></div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Last signed in</TableHead>
              <TableHead className="w-32" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map(orgUser => (
              <TableRow key={orgUser.id}>
                <TableCell>{orgUser.name || "—"}</TableCell>
                <TableCell>{orgUser.email}</TableCell>
                <TableCell>{orgUser.role}</TableCell>
                <TableCell>{orgUser.lastSignedIn ? new Date(orgUser.lastSignedIn).toLocaleString() : "—"}</TableCell>
                <TableCell>
                  <AlertDialog open={impersonatingUserId === orgUser.id} onOpenChange={open => { setImpersonatingUserId(open ? orgUser.id : null); if (!open) setImpersonateReason(""); }}>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="outline">Impersonate</Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Impersonate {orgUser.name || orgUser.email}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          You'll act as this user for up to an hour. This is logged to the organization's audit trail.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <Textarea value={impersonateReason} onChange={event => setImpersonateReason(event.target.value)} placeholder="Reason (required)" maxLength={300} />
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          disabled={impersonateReason.trim().length < 3 || startImpersonation.isPending}
                          onClick={() => startImpersonation.mutate({ userId: orgUser.id, reason: impersonateReason.trim() })}
                        >
                          Start impersonation
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="rounded-xl border bg-white">
        <div className="border-b px-4 py-3"><h2 className="text-sm font-semibold">Recent activity</h2></div>
        <div className="divide-y">
          {recentAuditLogs.length ? recentAuditLogs.map(log => (
            <div key={log.id} className="px-4 py-2.5 text-sm">
              <p className="font-medium">{log.action}</p>
              <p className="text-xs text-muted-foreground">{new Date(log.createdAt).toLocaleString()} · {log.entityType}{log.entityId ? ` #${log.entityId}` : ""}</p>
            </div>
          )) : <p className="px-4 py-6 text-sm text-muted-foreground">No activity recorded yet.</p>}
        </div>
      </div>
    </div>
  );
}
