import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { ReasonDialog } from "@/components/ReasonDialog";
import { useReauth } from "@/components/ReauthDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const when = (value: string | Date | null | undefined) => (value ? new Date(value).toLocaleString() : "—");
const Status = ({ ok, children }: { ok: boolean; children: React.ReactNode }) => <li className="flex items-center gap-2"><Badge variant={ok ? "secondary" : "destructive"}>{ok ? "OK" : "Check"}</Badge>{children}</li>;

export default function SecurityPage() {
  const me = trpc.auth.me.useQuery();
  const isSuperadmin = me.data?.platformRole === "superadmin";
  const status = trpc.admin.security.status.useQuery(undefined, { enabled: isSuperadmin });
  const sessions = trpc.admin.sessions.list.useQuery(undefined, { enabled: isSuperadmin });
  const utils = trpc.useUtils();
  const reauth = useReauth();
  const [revokeAll, setRevokeAll] = useState(false);
  const [revoking, setRevoking] = useState<number | null>(null);
  const refresh = () => { utils.admin.sessions.list.invalidate(); utils.admin.security.status.invalidate(); };
  const revokeOne = trpc.admin.sessions.revoke.useMutation({
    onSuccess: () => { refresh(); toast.success("Session revoked"); },
    onError: (error, variables) => { if (!reauth.handleError(error, () => revokeOne.mutate(variables))) toast.error(error.message); },
  });
  const revokeEveryone = trpc.admin.sessions.revokeAll.useMutation({
    onSuccess: result => { refresh(); toast.success(`${result.revoked} session(s) ended`); },
    onError: (error, variables) => { if (!reauth.handleError(error, () => revokeEveryone.mutate(variables))) toast.error(error.message); },
  });

  if (me.data && !isSuperadmin) return <div className="space-y-2"><h1 className="text-2xl font-semibold">Security</h1><p className="text-sm text-muted-foreground">Only superadmins can see this page.</p></div>;
  if (!status.data) return <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  const { database, configuration, operators, referenceViolations, alerts, events } = status.data;
  const violations = referenceViolations.filter(row => row.rows > 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Security</h1>
        <p className="text-sm text-muted-foreground">Live checks of this deployment. See docs/SECURITY-CHECKS.md for what each one means.</p>
      </div>

      <section className="space-y-3 rounded-xl border bg-white p-4">
        <h2 className="text-sm font-semibold">Database</h2>
        <ul className="space-y-1.5 text-sm">
          <Status ok={database.tablesWithoutRls.length === 0}>Row-level security on every table ({database.tableCount} tables){database.tablesWithoutRls.length ? `: missing on ${database.tablesWithoutRls.join(", ")}` : ""}</Status>
          <Status ok={!database.apiRolesPresent || database.apiGrants === 0}>Public API roles hold {database.apiRolesPresent ? `${database.apiGrants} table grants` : "no grants (roles absent)"}</Status>
          <Status ok={database.appliedMigrations !== null && database.appliedMigrations >= database.repoMigrations}>Migrations applied: {database.appliedMigrations ?? "unknown"} of {database.repoMigrations} in this release</Status>
          <Status ok={violations.length === 0}>Cross-tenant references: {violations.length === 0 ? "none found" : violations.map(row => `${row.child}.${row.column} -> ${row.parent} (${row.rows})`).join("; ")}</Status>
        </ul>
      </section>

      <section className="space-y-3 rounded-xl border bg-white p-4">
        <h2 className="text-sm font-semibold">Operators and configuration</h2>
        <ul className="space-y-1.5 text-sm">
          <Status ok={operators.activeSuperadmins >= 2}>{operators.activeSuperadmins} active superadmin(s) with a password{operators.activeSuperadmins < 2 ? " - keep at least two so one lost account cannot lock you out" : ""}</Status>
          <Status ok={operators.withoutPassword === 0}>{operators.withoutPassword} invited operator(s) have not set a password yet</Status>
          <Status ok={configuration.authBaseUrlSet}>Public site URL (AUTH_BASE_URL) is set</Status>
          <Status ok={!configuration.rateLimitsDisabled}>Rate limits are active</Status>
          <Status ok={configuration.emailConfigured}>Email is configured (operator and reset links can be emailed)</Status>
          <Status ok={configuration.storageConfigured}>Document storage is configured</Status>
          <Status ok={configuration.sentryConfigured}>Error monitoring is configured</Status>
        </ul>
      </section>

      <section className="space-y-3 rounded-xl border bg-white p-4">
        <h2 className="text-sm font-semibold">Alerts</h2>
        <ul className="space-y-1.5 text-sm">
          <Status ok={alerts.lockoutsLast24h === 0}>{alerts.lockoutsLast24h} sign-in attempt(s) blocked by lockout in the last 24 hours</Status>
          <Status ok={alerts.failedLoginsLast24h < 20}>{alerts.failedLoginsLast24h} failed sign-in(s) in the last 24 hours</Status>
          <Status ok={alerts.writeImpersonationsLast7d === 0}>{alerts.writeImpersonationsLast7d} write-mode impersonation(s) in the last 7 days</Status>
          <Status ok={alerts.newIpOperatorLogins.length === 0}>{alerts.newIpOperatorLogins.length} operator sign-in(s) from a new address in the last 7 days{alerts.newIpOperatorLogins.length ? `: ${alerts.newIpOperatorLogins.slice(0, 5).map(login => `user #${login.userId} from ${login.ip}`).join(", ")}` : ""}</Status>
        </ul>
      </section>

      <section className="space-y-3 rounded-xl border bg-white">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Active sessions</h2>
          <Button variant="destructive" size="sm" onClick={() => setRevokeAll(true)}>Sign out everyone else</Button>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>User</TableHead><TableHead>Last used</TableHead><TableHead>Expires</TableHead><TableHead>Type</TableHead><TableHead className="w-24" /></TableRow></TableHeader>
            <TableBody>
              {sessions.data?.map(session => (
                <TableRow key={session.id}>
                  <TableCell>{session.email}</TableCell>
                  <TableCell className="text-xs">{when(session.lastUsedAt)}</TableCell>
                  <TableCell className="text-xs">{when(session.expiresAt)}</TableCell>
                  <TableCell>{session.impersonatedBy ? <Badge variant="destructive">impersonation ({session.mode})</Badge> : <Badge variant="outline">normal</Badge>}</TableCell>
                  <TableCell><Button size="sm" variant="ghost" onClick={() => setRevoking(session.id)}>Revoke</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="space-y-2 rounded-xl border bg-white p-4">
        <h2 className="text-sm font-semibold">Recent sign-in events</h2>
        {events.map(event => <p key={event.id} className="text-xs text-muted-foreground">{when(event.createdAt)} · {event.type} · {event.userId ? `user #${event.userId}` : "unknown account"} · {event.ip ?? "unknown address"}</p>)}
        {!events.length && <p className="text-xs text-muted-foreground">Nothing notable.</p>}
      </section>

      <ReasonDialog open={revokeAll} title="Sign out everyone else?" description="Every other session on the platform ends immediately, including shop staff. Use this after a credential exposure." confirmLabel="Sign out everyone" onCancel={() => setRevokeAll(false)} onConfirm={reason => { setRevokeAll(false); revokeEveryone.mutate({ reason }); }} />
      <ReasonDialog open={revoking !== null} title="Revoke this session?" description="The person is signed out of this device immediately." confirmLabel="Revoke" onCancel={() => setRevoking(null)} onConfirm={reason => { const sessionId = revoking!; setRevoking(null); revokeOne.mutate({ sessionId, reason }); }} />
    </div>
  );
}
