import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function PlatformStaffList() {
  const staff = trpc.admin.staff.list.useQuery();
  const utils = trpc.useUtils();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"support" | "superadmin">("support");

  const grant = trpc.admin.staff.grant.useMutation({
    onSuccess: () => {
      utils.admin.staff.list.invalidate();
      setEmail("");
      toast.success("Access granted");
    },
    onError: error => toast.error(error.message),
  });
  const revoke = trpc.admin.staff.revoke.useMutation({
    onSuccess: () => {
      utils.admin.staff.list.invalidate();
      toast.success("Access revoked");
    },
    onError: error => toast.error(error.message),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Platform staff</h1>
        <p className="text-sm text-muted-foreground">People who can access this operator console.</p>
      </div>

      <form
        className="flex flex-wrap items-end gap-3 rounded-xl border bg-white p-4"
        onSubmit={event => {
          event.preventDefault();
          if (!email.trim()) {
            toast.error("Enter an email address.");
            return;
          }
          grant.mutate({ email: email.trim(), role });
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="staff-email">Email</Label>
          <Input id="staff-email" type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="person@example.com" className="w-64" />
        </div>
        <div className="space-y-1.5">
          <Label>Role</Label>
          <Select value={role} onValueChange={value => setRole(value as "support" | "superadmin")}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="support">Support</SelectItem>
              <SelectItem value="superadmin">Superadmin</SelectItem>
            </SelectContent>
          </Select>
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
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {staff.data?.map(row => (
                <TableRow key={row.id}>
                  <TableCell>{row.name || "—"}</TableCell>
                  <TableCell>{row.email}</TableCell>
                  <TableCell><Badge variant="outline">{row.role}</Badge></TableCell>
                  <TableCell><Badge variant={row.isActive ? "secondary" : "destructive"}>{row.isActive ? "Active" : "Revoked"}</Badge></TableCell>
                  <TableCell>
                    {row.isActive && (
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={revoke.isPending} onClick={() => revoke.mutate({ userId: row.userId })}>
                        Revoke
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!staff.data?.length && (
                <TableRow><TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">No platform staff yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
