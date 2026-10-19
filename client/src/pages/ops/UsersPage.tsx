import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { ReasonDialog } from "@/components/ReasonDialog";
import { useReauth } from "@/components/ReauthDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const when = (value: string | Date | null | undefined) => (value ? new Date(value).toLocaleString() : "—");

export default function UsersPage() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const results = trpc.admin.users.search.useQuery({ query });
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Users</h1>
        <p className="text-sm text-muted-foreground">Search every user across all shops and review exactly what each one can do.</p>
      </div>
      <Input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search by name or email" className="max-w-md" aria-label="Search users" />
      <div className="overflow-x-auto rounded-xl border bg-white">
        <Table>
          <TableHeader>
            <TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Shop</TableHead><TableHead>Operator</TableHead><TableHead>Last signed in</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {results.isLoading && <TableRow><TableCell colSpan={5} className="py-6 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></TableCell></TableRow>}
            {results.data?.map(row => (
              <TableRow key={row.id} className="cursor-pointer" data-state={selected === row.id ? "selected" : undefined} onClick={() => setSelected(row.id)}>
                <TableCell>{row.name || "—"}</TableCell>
                <TableCell>{row.email}{!row.hasPassword && <Badge variant="outline" className="ml-2">Setup pending</Badge>}</TableCell>
                <TableCell>{row.organizationName ?? "—"}</TableCell>
                <TableCell>{row.platformRole ? <Badge variant={row.platformActive ? "secondary" : "destructive"}>{row.platformRole}{row.platformActive ? "" : " (revoked)"}</Badge> : "—"}</TableCell>
                <TableCell>{when(row.lastSignedIn)}</TableCell>
              </TableRow>
            ))}
            {results.data && !results.data.length && <TableRow><TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">No users found.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
      {selected !== null && <UserDetail userId={selected} />}
    </div>
  );
}

function UserDetail({ userId }: { userId: number }) {
  const detail = trpc.admin.users.detail.useQuery({ userId });
  const me = trpc.auth.me.useQuery();
  const utils = trpc.useUtils();
  const reauth = useReauth();
  const [signingOut, setSigningOut] = useState(false);
  const signOut = trpc.admin.users.signOut.useMutation({
    onSuccess: () => { utils.admin.users.detail.invalidate({ userId }); toast.success("Signed out everywhere"); },
    onError: (error, variables) => { if (!reauth.handleError(error, () => signOut.mutate(variables))) toast.error(error.message); },
  });
  if (detail.isLoading) return <div className="flex justify-center p-6"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  if (!detail.data) return null;
  const { user, organization, businessRole, customRole, platformStaff, effective, sessions, events, isOwner } = detail.data;
  return (
    <div className="space-y-4 rounded-xl border bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{user.name || user.email}</h2>
          <p className="text-sm text-muted-foreground">{user.email} · created {when(user.createdAt)} · last signed in {when(user.lastSignedIn)}</p>
        </div>
        {me.data?.platformRole === "superadmin" && <Button variant="outline" onClick={() => setSigningOut(true)}>Sign out everywhere</Button>}
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div><dt className="text-muted-foreground">Shop</dt><dd className="font-medium">{organization ? `${organization.name} (${organization.status})` : "None (platform-only)"}{isOwner ? " · owner" : ""}</dd></div>
        <div><dt className="text-muted-foreground">Base role</dt><dd className="font-medium">{businessRole ? `${businessRole.role}${businessRole.isPlaceholder ? " (placeholder)" : ""}${businessRole.isActive ? "" : " (inactive)"}` : "None"}</dd></div>
        <div><dt className="text-muted-foreground">Custom role</dt><dd className="font-medium">{customRole ? `${customRole.name}${customRole.active ? "" : " (inactive)"}` : "None"}{customRole && Array.isArray(customRole.permissions) ? ` · ${(customRole.permissions as string[]).join(", ")}` : ""}</dd></div>
        <div><dt className="text-muted-foreground">Operator access</dt><dd className="font-medium">{platformStaff ? `${platformStaff.role}${platformStaff.isActive ? "" : " (revoked)"}` : "None"}</dd></div>
      </dl>
      {effective.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Effective access</h3>
          <ul className="grid gap-1 text-sm sm:grid-cols-2">
            {effective.map(row => <li key={row.label} className="flex items-center gap-2"><Badge variant={row.allowed ? "secondary" : "outline"}>{row.allowed ? "Yes" : "No"}</Badge>{row.label}</li>)}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">Computed by the same code that guards every request, so this view cannot disagree with what the user can actually do.</p>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold">Sessions</h3>
          {sessions.length ? sessions.map(session => <p key={session.id} className="text-xs text-muted-foreground">#{session.id} · last used {when(session.lastUsedAt)} · expires {when(session.expiresAt)}{session.impersonatedBy ? ` · impersonation (${session.mode})` : ""}</p>) : <p className="text-xs text-muted-foreground">No active sessions.</p>}
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold">Recent sign-in events</h3>
          {events.length ? events.map(event => <p key={event.id} className="text-xs text-muted-foreground">{when(event.createdAt)} · {event.type} · {event.ip ?? "unknown address"}</p>) : <p className="text-xs text-muted-foreground">Nothing recorded yet.</p>}
        </div>
      </div>
      <ReasonDialog open={signingOut} title={`Sign out ${user.name || user.email}?`} description="Every session this person has is ended immediately. Use this if you suspect their account is compromised." confirmLabel="Sign out" onCancel={() => setSigningOut(false)} onConfirm={reason => { setSigningOut(false); signOut.mutate({ userId, reason }); }} />
    </div>
  );
}
