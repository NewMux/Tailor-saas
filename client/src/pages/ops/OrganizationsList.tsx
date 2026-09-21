import { Loader2 } from "lucide-react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function OrganizationsList() {
  const orgs = trpc.admin.organizations.list.useQuery();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Organizations</h1>
        <p className="text-sm text-muted-foreground">Every tenant on this platform.</p>
      </div>

      {orgs.isLoading ? (
        <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organization</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Users</TableHead>
                <TableHead>Last activity</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead className="w-14" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {orgs.data?.map(org => (
                <TableRow key={org.id}>
                  <TableCell>
                    <Link href={`/ops/orgs/${org.id}`} className="font-medium hover:underline">{org.name}</Link>
                    <p className="text-xs text-muted-foreground">{org.slug}</p>
                  </TableCell>
                  <TableCell><Badge variant={org.status === "suspended" ? "destructive" : "secondary"}>{org.status}</Badge></TableCell>
                  <TableCell>{org.userCount}</TableCell>
                  <TableCell>{org.lastActivityAt ? new Date(org.lastActivityAt).toLocaleString() : "—"}</TableCell>
                  <TableCell><Badge variant="outline">{org.planStatus}</Badge></TableCell>
                  <TableCell><Link href={`/ops/orgs/${org.id}`} className="text-sm text-primary hover:underline">View</Link></TableCell>
                </TableRow>
              ))}
              {!orgs.data?.length && (
                <TableRow><TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">No organizations yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
