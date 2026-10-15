import { Copy, Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function OrganizationsList() {
  const orgs = trpc.admin.organizations.list.useQuery();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Organizations</h1>
          <p className="text-sm text-muted-foreground">Every tenant on this platform. New shops are created here; there is no public sign-up.</p>
        </div>
        <CreateShopDialog />
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

export function copySetupLink(url: string) {
  navigator.clipboard?.writeText(url).then(
    () => toast.success("Setup link copied"),
    () => toast.error("Unable to copy the link"),
  );
}

/** Shows a freshly created owner setup link, which can't be retrieved again later. */
export function SetupLinkNotice({ setupUrl, emailed }: { setupUrl: string; emailed: boolean }) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        {emailed
          ? "We emailed this link to the owner. You can also send it yourself."
          : "Email isn't set up, so send this link to the owner yourself."}{" "}
        It works once and expires in 7 days.
      </p>
      <div className="flex gap-2">
        <Input readOnly value={setupUrl} onFocus={event => event.currentTarget.select()} className="font-mono text-xs" />
        <Button type="button" variant="outline" size="icon" onClick={() => copySetupLink(setupUrl)} aria-label="Copy setup link">
          <Copy className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function CreateShopDialog() {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [shopName, setShopName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const create = trpc.admin.organizations.create.useMutation({
    onSuccess: () => {
      utils.admin.organizations.list.invalidate();
      toast.success("Shop created");
    },
    onError: error => toast.error(error.message),
  });

  const close = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setShopName("");
      setOwnerName("");
      setOwnerEmail("");
      create.reset();
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <Button onClick={() => setOpen(true)}><Plus className="mr-2 h-4 w-4" />Create shop</Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{create.data ? "Shop created" : "Create a shop"}</DialogTitle>
          <DialogDescription>
            {create.data
              ? `${shopName} is ready. The owner signs in after choosing a password with this link.`
              : "Creates the shop with its owner as administrator. The owner gets a one-time link to choose their password."}
          </DialogDescription>
        </DialogHeader>
        {create.data ? (
          <>
            <SetupLinkNotice setupUrl={create.data.setupUrl} emailed={create.data.emailed} />
            <DialogFooter>
              <Button onClick={() => close(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form
            className="space-y-4"
            onSubmit={event => {
              event.preventDefault();
              create.mutate({ shopName: shopName.trim(), ownerName: ownerName.trim(), ownerEmail: ownerEmail.trim() });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="shop-name">Shop name</Label>
              <Input id="shop-name" value={shopName} onChange={event => setShopName(event.target.value)} required minLength={2} maxLength={160} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="owner-name">Owner's full name</Label>
              <Input id="owner-name" value={ownerName} onChange={event => setOwnerName(event.target.value)} required minLength={2} maxLength={160} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="owner-email">Owner's email</Label>
              <Input id="owner-email" type="email" value={ownerEmail} onChange={event => setOwnerEmail(event.target.value)} required maxLength={320} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => close(false)}>Cancel</Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create shop
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
