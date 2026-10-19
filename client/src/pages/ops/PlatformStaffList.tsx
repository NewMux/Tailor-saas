import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useReauth } from "@/components/ReauthDialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { SetupLinkNotice } from "./OrganizationsList";

type Role = "support" | "superadmin";
type PendingChange = { kind: "revoke"; userId: number; label: string } | { kind: "role"; userId: number; label: string; role: Role };

export default function PlatformStaffList() {
  const me = trpc.auth.me.useQuery();
  const staff = trpc.admin.staff.list.useQuery(undefined, { enabled: me.data?.platformRole === "superadmin" });
  const utils = trpc.useUtils();
  const reauth = useReauth();

  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("support");
  const [inviteReason, setInviteReason] = useState("");
  const [grantEmail, setGrantEmail] = useState("");
  const [grantRole, setGrantRole] = useState<Role>("support");
  const [grantReason, setGrantReason] = useState("");
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [changeReason, setChangeReason] = useState("");

  const refresh = () => utils.admin.staff.list.invalidate();
  const fail = <V,>(retry: (variables: V) => void) => (error: { message: string }, variables: V) => {
    if (!reauth.handleError(error, () => retry(variables))) toast.error(error.message);
  };

  const invite = trpc.admin.staff.invite.useMutation({
    onSuccess: () => {
      refresh();
      setInviteName("");
      setInviteEmail("");
      setInviteReason("");
      toast.success("Operator invited");
    },
    onError: fail(variables => invite.mutate(variables)),
  });
  const grant = trpc.admin.staff.grant.useMutation({
    onSuccess: () => {
      refresh();
      setGrantEmail("");
      setGrantReason("");
      toast.success("Access granted");
    },
    onError: fail(variables => grant.mutate(variables)),
  });
  const revoke = trpc.admin.staff.revoke.useMutation({
    onSuccess: () => {
      refresh();
      toast.success("Access revoked");
    },
    onError: fail(variables => revoke.mutate(variables)),
  });
  const setRole = trpc.admin.staff.setRole.useMutation({
    onSuccess: () => {
      refresh();
      toast.success("Role changed");
    },
    onError: fail(variables => setRole.mutate(variables)),
  });

  if (me.data && me.data.platformRole !== "superadmin") {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Platform staff</h1>
        <p className="text-sm text-muted-foreground">Only superadmins can manage platform staff.</p>
      </div>
    );
  }

  const confirmChange = () => {
    if (!pending) return;
    const reason = changeReason.trim();
    if (pending.kind === "revoke") revoke.mutate({ userId: pending.userId, reason });
    else setRole.mutate({ userId: pending.userId, role: pending.role, reason });
    setPending(null);
    setChangeReason("");
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Platform staff</h1>
        <p className="text-sm text-muted-foreground">People who can access this operator console. Every change is recorded in the audit trail.</p>
      </div>

      <form
        className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-2"
        onSubmit={event => {
          event.preventDefault();
          invite.mutate({ name: inviteName.trim(), email: inviteEmail.trim(), role: inviteRole, reason: inviteReason.trim() });
        }}
      >
        <div className="sm:col-span-2">
          <h2 className="text-sm font-semibold">Invite a teammate</h2>
          <p className="text-xs text-muted-foreground">Creates an operator account that is not tied to any shop, and a one-time link to choose a password.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="invite-name">Full name</Label>
          <Input id="invite-name" value={inviteName} onChange={event => setInviteName(event.target.value)} required minLength={2} maxLength={160} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="invite-email">Email</Label>
          <Input id="invite-email" type="email" value={inviteEmail} onChange={event => setInviteEmail(event.target.value)} required maxLength={320} />
        </div>
        <div className="space-y-1.5">
          <Label>Role</Label>
          <RoleSelect value={inviteRole} onChange={setInviteRole} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="invite-reason">Reason</Label>
          <Input id="invite-reason" value={inviteReason} onChange={event => setInviteReason(event.target.value)} required minLength={3} maxLength={300} placeholder="e.g. Joins the support rota" />
        </div>
        <div className="sm:col-span-2">
          <Button disabled={invite.isPending}>Send invite</Button>
        </div>
        {invite.data && (
          <div className="rounded-lg border bg-amber-50/50 p-3 sm:col-span-2">
            <SetupLinkNotice setupUrl={invite.data.setupUrl} emailed={invite.data.emailed} who="new operator" expires="24 hours" />
          </div>
        )}
      </form>

      <form
        className="flex flex-wrap items-end gap-3 rounded-xl border bg-white p-4"
        onSubmit={event => {
          event.preventDefault();
          grant.mutate({ email: grantEmail.trim(), role: grantRole, reason: grantReason.trim() });
        }}
      >
        <div className="w-full">
          <h2 className="text-sm font-semibold">Grant access to an existing account</h2>
          <p className="text-xs text-muted-foreground">For someone who already has an account with a password.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="grant-email">Email</Label>
          <Input id="grant-email" type="email" value={grantEmail} onChange={event => setGrantEmail(event.target.value)} className="w-64" required />
        </div>
        <div className="space-y-1.5">
          <Label>Role</Label>
          <RoleSelect value={grantRole} onChange={setGrantRole} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="grant-reason">Reason</Label>
          <Input id="grant-reason" value={grantReason} onChange={event => setGrantReason(event.target.value)} className="w-64" required minLength={3} maxLength={300} />
        </div>
        <Button disabled={grant.isPending}>Grant access</Button>
      </form>

      {staff.isLoading ? (
        <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-48" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {staff.data?.map(row => {
                const isSelf = row.userId === me.data?.id;
                const label = row.name || row.email || `user #${row.userId}`;
                return (
                  <TableRow key={row.id}>
                    <TableCell>{row.name || "—"}{isSelf && <Badge variant="outline" className="ml-2">You</Badge>}</TableCell>
                    <TableCell>{row.email}</TableCell>
                    <TableCell><Badge variant="outline">{row.role}</Badge></TableCell>
                    <TableCell>
                      <Badge variant={row.isActive ? "secondary" : "destructive"}>{row.isActive ? "Active" : "Revoked"}</Badge>
                      {row.isActive && !row.hasPassword && <Badge variant="outline" className="ml-2">Setup pending</Badge>}
                    </TableCell>
                    <TableCell className="space-x-1 text-right">
                      {row.isActive && !isSelf && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => { setChangeReason(""); setPending({ kind: "role", userId: row.userId, label, role: row.role === "superadmin" ? "support" : "superadmin" }); }}>
                            Make {row.role === "superadmin" ? "support" : "superadmin"}
                          </Button>
                          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => { setChangeReason(""); setPending({ kind: "revoke", userId: row.userId, label }); }}>
                            Revoke
                          </Button>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {!staff.data?.length && (
                <TableRow><TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">No platform staff yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <AlertDialog open={pending !== null} onOpenChange={open => { if (!open) setPending(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.kind === "revoke" ? `Revoke ${pending.label}?` : pending ? `Make ${pending.label} ${pending.kind === "role" ? pending.role : ""}?` : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              They are signed out everywhere immediately. This is recorded in the audit trail with your reason.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea value={changeReason} onChange={event => setChangeReason(event.target.value)} placeholder="Reason (required)" maxLength={300} />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={changeReason.trim().length < 3} onClick={confirmChange}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function RoleSelect({ value, onChange }: { value: Role; onChange: (role: Role) => void }) {
  return (
    <Select value={value} onValueChange={next => onChange(next as Role)}>
      <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="support">Support (read-only)</SelectItem>
        <SelectItem value="superadmin">Superadmin</SelectItem>
      </SelectContent>
    </Select>
  );
}
