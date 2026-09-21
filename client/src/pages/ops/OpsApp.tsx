import { Route, Switch } from "wouter";
import NotFound from "@/pages/NotFound";
import OpsShell from "./OpsShell";
import OrganizationDetail from "./OrganizationDetail";
import OrganizationsList from "./OrganizationsList";
import PlatformAuditFeed from "./PlatformAuditFeed";
import PlatformStaffList from "./PlatformStaffList";

export default function OpsApp() {
  return (
    <OpsShell>
      <Switch>
        <Route path="/ops" component={OrganizationsList} />
        <Route path="/ops/orgs/:id" component={OrganizationDetail} />
        <Route path="/ops/staff" component={PlatformStaffList} />
        <Route path="/ops/audit" component={PlatformAuditFeed} />
        <Route component={NotFound} />
      </Switch>
    </OpsShell>
  );
}
