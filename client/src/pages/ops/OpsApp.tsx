import { Route, Switch } from "wouter";
import NotFound from "@/pages/NotFound";
import OpsShell from "./OpsShell";
import OrganizationDetail from "./OrganizationDetail";
import OrganizationsList from "./OrganizationsList";
import AuditExplorer from "./AuditExplorer";
import SecurityPage from "./SecurityPage";
import UsersPage from "./UsersPage";
import PlatformStaffList from "./PlatformStaffList";

export default function OpsApp() {
  return (
    <OpsShell>
      <Switch>
        <Route path="/ops" component={OrganizationsList} />
        <Route path="/ops/orgs/:id" component={OrganizationDetail} />
        <Route path="/ops/staff" component={PlatformStaffList} />
        <Route path="/ops/users" component={UsersPage} />
        <Route path="/ops/audit" component={AuditExplorer} />
        <Route path="/ops/security" component={SecurityPage} />
        <Route component={NotFound} />
      </Switch>
    </OpsShell>
  );
}
