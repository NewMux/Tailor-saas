import { Loader2 } from "lucide-react";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Row = {
  source: "tenant" | "platform";
  id: number;
  createdAt: Date | string;
  organizationId: number | null;
  actorId: number | null;
  actorEmail: string | null;
  action: string;
  targetType: string;
  targetId: number | null;
  impersonatedBy: number | null;
  details: unknown;
};

const csvCell = (value: unknown) => {
  const text = value === null || value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
  // A leading = + - @ would be run as a formula by spreadsheets.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};

function downloadCsv(rows: Row[]) {
  const header = ["time", "source", "organization", "actor", "operator (impersonating)", "action", "target", "details"];
  const lines = rows.map(row => [new Date(row.createdAt).toISOString(), row.source, row.organizationId, row.actorEmail ?? row.actorId, row.impersonatedBy, row.action, `${row.targetType}${row.targetId ? ` #${row.targetId}` : ""}`, row.details].map(csvCell).join(","));
  const blob = new Blob([[header.map(csvCell).join(","), ...lines].join("\n")], { type: "text/csv" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `audit-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

export default function AuditExplorer() {
  const [source, setSource] = useState<"all" | "tenant" | "platform">("all");
  const [organizationId, setOrganizationId] = useState("");
  const [action, setAction] = useState("");
  const [impersonatedOnly, setImpersonatedOnly] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [older, setOlder] = useState<Row[]>([]);
  const [before, setBefore] = useState<Date | string | undefined>();

  const filters = {
    source,
    organizationId: Number(organizationId) > 0 ? Number(organizationId) : undefined,
    action: action.trim() || undefined,
    impersonatedOnly,
    from: from ? new Date(from) : undefined,
    to: to ? new Date(`${to}T23:59:59`) : undefined,
  };
  const page = trpc.admin.audit.search.useQuery({ ...filters, limit: 50 });
  const more = trpc.admin.audit.search.useQuery({ ...filters, limit: 50, before: before ? new Date(before) : undefined }, { enabled: Boolean(before) });
  const rows: Row[] = [...(page.data?.rows ?? []), ...older, ...((before && more.data?.rows) || [])];
  const next = before ? more.data?.nextBefore : page.data?.nextBefore;
  const reset = () => { setOlder([]); setBefore(undefined); };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Audit</h1>
        <p className="text-sm text-muted-foreground">Every recorded action across all shops, plus operator actions that belong to no shop.</p>
      </div>
      <div className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-3 lg:grid-cols-6">
        <div className="space-y-1.5">
          <Label>Source</Label>
          <Select value={source} onValueChange={value => { setSource(value as typeof source); reset(); }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="tenant">Shop activity</SelectItem>
              <SelectItem value="platform">Operator actions</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5"><Label htmlFor="audit-org">Shop id</Label><Input id="audit-org" inputMode="numeric" value={organizationId} onChange={event => { setOrganizationId(event.target.value); reset(); }} /></div>
        <div className="space-y-1.5"><Label htmlFor="audit-action">Action</Label><Input id="audit-action" value={action} onChange={event => { setAction(event.target.value); reset(); }} placeholder="e.g. STAFF_GRANTED" /></div>
        <div className="space-y-1.5"><Label htmlFor="audit-from">From</Label><Input id="audit-from" type="date" value={from} onChange={event => { setFrom(event.target.value); reset(); }} /></div>
        <div className="space-y-1.5"><Label htmlFor="audit-to">To</Label><Input id="audit-to" type="date" value={to} onChange={event => { setTo(event.target.value); reset(); }} /></div>
        <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={impersonatedOnly} onChange={event => { setImpersonatedOnly(event.target.checked); reset(); }} />Actions during impersonation</label>
      </div>
      <div className="flex justify-end"><Button variant="outline" disabled={!rows.length} onClick={() => downloadCsv(rows)}>Export CSV ({rows.length})</Button></div>
      <div className="overflow-x-auto rounded-xl border bg-white">
        <Table>
          <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Action</TableHead><TableHead>Shop</TableHead><TableHead>Who</TableHead><TableHead>Target</TableHead><TableHead>Details</TableHead></TableRow></TableHeader>
          <TableBody>
            {page.isLoading && <TableRow><TableCell colSpan={6} className="py-6 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></TableCell></TableRow>}
            {rows.map(row => (
              <TableRow key={`${row.source}-${row.id}`}>
                <TableCell className="whitespace-nowrap text-xs">{new Date(row.createdAt).toLocaleString()}</TableCell>
                <TableCell><span className="font-medium">{row.action}</span> {row.source === "platform" && <Badge variant="outline">operator</Badge>}</TableCell>
                <TableCell>{row.organizationId ?? "—"}</TableCell>
                <TableCell className="text-xs">{row.actorEmail ?? (row.actorId ? `user #${row.actorId}` : "script")}{row.impersonatedBy ? <Badge variant="destructive" className="ml-2">by operator #{row.impersonatedBy}</Badge> : null}</TableCell>
                <TableCell className="text-xs">{row.targetType}{row.targetId ? ` #${row.targetId}` : ""}</TableCell>
                <TableCell className="max-w-xs truncate font-mono text-xs" title={row.details ? JSON.stringify(row.details) : ""}>{row.details ? JSON.stringify(row.details) : ""}</TableCell>
              </TableRow>
            ))}
            {page.data && !rows.length && <TableRow><TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">No entries match.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
      {next && <div className="flex justify-center"><Button variant="outline" disabled={more.isFetching} onClick={() => { if (before && more.data) setOlder(current => [...current, ...more.data.rows]); setBefore(next); }}>Load older</Button></div>}
    </div>
  );
}
