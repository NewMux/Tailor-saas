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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SetupLinkNotice } from "./OrganizationsList";
import { useReauth } from "@/components/ReauthDialog";

export default function OrganizationDetail() {
  const { id } = useParams<{ id: string }>();
  const organizationId = Number(id);
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const detail = trpc.admin.organizations.detail.useQuery({ organizationId }, { enabled: Number.isFinite(organizationId) });
  const me = trpc.auth.me.useQuery();
  const isSuperadmin = me.data?.platformRole === "superadmin";
  const reauth = useReauth();
  const [impersonateMode, setImpersonateMode] = useState<"readonly" | "write">("readonly");
  // A password-confirmation request re-runs the action once confirmed; other errors are shown.
  const fail = <V,>(retry: (variables: V) => void) => (error: { message: string }, variables: V) => {
    if (!reauth.handleError(error, () => retry(variables))) toast.error(error.message);
  };

  const [suspendDialogOpen, setSuspendDialogOpen] = useState(false);
  const [suspendReason, setSuspendReason] = useState("");
  const [impersonateReason, setImpersonateReason] = useState("");
  const [impersonatingUserId, setImpersonatingUserId] = useState<number | null>(null);
  const ownerSetupLink = trpc.admin.organizations.ownerSetupLink.useMutation({
    onSuccess: () => {
      utils.admin.organizations.detail.invalidate({ organizationId });
      toast.success("New setup link created");
    },
    onError: fail(variables => ownerSetupLink.mutate(variables)),
  });

  const suspend = trpc.admin.organizations.suspend.useMutation({
    onSuccess: () => {
      utils.admin.organizations.detail.invalidate({ organizationId });
      utils.admin.organizations.list.invalidate();
      setSuspendReason("");
      setSuspendDialogOpen(false);
      toast.success("Organization suspended");
    },
    onError: fail(variables => suspend.mutate(variables)),
  });
  const reactivate = trpc.admin.organizations.reactivate.useMutation({
    onSuccess: () => {
      utils.admin.organizations.detail.invalidate({ organizationId });
      utils.admin.organizations.list.invalidate();
      toast.success("Organization reactivated");
    },
    onError: fail(variables => reactivate.mutate(variables)),
  });
  const [exemptReason, setExemptReason] = useState("");
  const [trialDays, setTrialDays] = useState("14");
  const refreshDetail = () => {
    utils.admin.organizations.detail.invalidate({ organizationId });
    utils.admin.organizations.list.invalidate();
  };
  const setBillingExempt = trpc.admin.organizations.setBillingExempt.useMutation({
    onSuccess: organization => {
      refreshDetail();
      setExemptReason("");
      toast.success(organization.billingExempt ? "Billing exemption granted" : "Billing exemption removed");
    },
    onError: error => toast.error(error.message),
  });
  const extendTrial = trpc.admin.organizations.extendTrial.useMutation({
    onSuccess: () => {
      refreshDetail();
      toast.success("Trial extended");
    },
    onError: error => toast.error(error.message),
  });
  const startImpersonation = trpc.admin.impersonation.start.useMutation({
    onSuccess: result => {
      authApi.beginImpersonation(result.token);
      toast.success(`Now viewing as ${result.target.name || result.target.email} (${result.mode === "write" ? "write access" : "read-only"})`);
      navigate("/");
    },
    onError: fail(variables => startImpersonation.mutate(variables)),
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

      {isSuperadmin && <div className="rounded-xl border bg-white p-4">
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
      </div>}

      <div className="rounded-xl border bg-white">
        <div className="border-b px-4 py-3"><h2 className="text-sm font-semibold">Billing</h2></div>
        <div className="space-y-4 p-4 text-sm">
          <dl className="grid gap-3 sm:grid-cols-3">
            <div><dt className="text-muted-foreground">Subscription</dt><dd className="font-medium">{organization.subscriptionStatus}{organization.billingExempt ? " (exempt)" : ""}</dd></div>
            <div><dt className="text-muted-foreground">Trial ends</dt><dd className="font-medium">{organization.trialEndsAt ? new Date(organization.trialEndsAt).toLocaleDateString() : "—"}</dd></div>
            <div><dt className="text-muted-foreground">Paid through</dt><dd className="font-medium">{organization.currentPeriodEndsAt ? new Date(organization.currentPeriodEndsAt).toLocaleDateString() : "—"}</dd></div>
            <div className="sm:col-span-3"><dt className="text-muted-foreground">Paddle</dt><dd className="break-all font-mono text-xs">{organization.paddleCustomerId ?? "no customer"} · {organization.paddleSubscriptionId ?? "no subscription"}</dd></div>
          </dl>
          {isSuperadmin && <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <label className="text-xs text-muted-foreground" htmlFor="exempt-reason">Reason (required to change exemption)</label>
              <Input id="exempt-reason" value={exemptReason} onChange={event => setExemptReason(event.target.value)} maxLength={300} placeholder="e.g. Partner shop, invoiced manually" />
            </div>
            <Button
              variant="outline"
              disabled={exemptReason.trim().length < 3 || setBillingExempt.isPending}
              onClick={() => setBillingExempt.mutate({ organizationId, exempt: !organization.billingExempt, reason: exemptReason.trim() })}
            >
              {organization.billingExempt ? "Remove exemption" : "Make billing-exempt"}
            </Button>
          </div>}
          {isSuperadmin && organization.subscriptionStatus !== "active" && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground" htmlFor="trial-days">Extend trial by (days)</label>
                <Input id="trial-days" type="number" min={1} max={365} value={trialDays} onChange={event => setTrialDays(event.target.value)} className="w-32" />
              </div>
              <Button
                variant="outline"
                disabled={!(Number(trialDays) >= 1 && Number(trialDays) <= 365) || extendTrial.isPending}
                onClick={() => extendTrial.mutate({ organizationId, days: Math.floor(Number(trialDays)) })}
              >
                Extend trial
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-white">
        <div className="border-b px-4 py-3"><h2 className="text-sm font-semibold">Users</h2></div>
        {ownerSetupLink.data && (
          <div className="border-b bg-amber-50/50 p-4">
            <SetupLinkNotice setupUrl={ownerSetupLink.data.setupUrl} emailed={false} />
          </div>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Account</TableHead>
              <TableHead>Last signed in</TableHead>
              <TableHead className="w-32" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map(orgUser => (
              <TableRow key={orgUser.id}>
                <TableCell>{orgUser.name || "—"}</TableCell>
                <TableCell>{orgUser.email}</TableCell>
                <TableCell>{orgUser.role}{orgUser.id === organization.ownerId ? " (owner)" : ""}</TableCell>
                <TableCell>
                  {orgUser.hasPassword ? (
                    <Badge variant="secondary">Active</Badge>
                  ) : (
                    <div className="space-y-1">
                      <Badge variant="outline">Setup pending</Badge>
                      {isSuperadmin && orgUser.id === organization.ownerId && (
                        <Button
                          size="sm"
                          variant="link"
                          className="h-auto p-0 text-xs"
                          disabled={ownerSetupLink.isPending}
                          onClick={() => ownerSetupLink.mutate({ organizationId })}
                        >
                          New setup link
                        </Button>
                      )}
                    </div>
                  )}
                </TableCell>
                <TableCell>{orgUser.lastSignedIn ? new Date(orgUser.lastSignedIn).toLocaleString() : "—"}</TableCell>
                <TableCell>
                  {isSuperadmin && <AlertDialog open={impersonatingUserId === orgUser.id} onOpenChange={open => { setImpersonatingUserId(open ? orgUser.id : null); if (!open) { setImpersonateReason(""); setImpersonateMode("readonly"); } }}>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="outline">Impersonate</Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Impersonate {orgUser.name || orgUser.email}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          You'll see the workspace as this user. Read-only sessions last up to an hour; write sessions last 15 minutes and allow only data fixes (customers, tailoring, inventory, services), never staff, roles or billing. Everything is logged to the organization's audit trail with your name.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Session type">
                        <Button type="button" role="radio" aria-checked={impersonateMode === "readonly"} variant={impersonateMode === "readonly" ? "default" : "outline"} onClick={() => setImpersonateMode("readonly")}>Read-only</Button>
                        <Button type="button" role="radio" aria-checked={impersonateMode === "write"} variant={impersonateMode === "write" ? "default" : "outline"} onClick={() => setImpersonateMode("write")}>Write (15 min)</Button>
                      </div>
                      <Textarea value={impersonateReason} onChange={event => setImpersonateReason(event.target.value)} placeholder="Reason (required)" maxLength={300} />
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          disabled={impersonateReason.trim().length < 3 || startImpersonation.isPending}
                          onClick={() => startImpersonation.mutate({ userId: orgUser.id, reason: impersonateReason.trim(), mode: impersonateMode })}
                        >
                          Start impersonation
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>}
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
