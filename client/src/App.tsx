import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import DashboardLayout from "@/components/DashboardLayout";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { OfflineSyncProvider } from "@/contexts/OfflineSyncContext";
import ErpWorkspace from "./pages/ErpWorkspace";
import PointOfSale from "./pages/PointOfSale";
import { CustomerMaintenance } from "./pages/OperationalRecovery";
import OwnerSettings from "./pages/OwnerSettings";
import TailoringOrders from "./pages/TailoringOrders";
import WorkforceHub from "./pages/WorkforceHub";
import SalesHistory from "./pages/SalesHistory";
import NotFound from "./pages/NotFound";
import OpsApp from "./pages/ops/OpsApp";
import { Route, Switch, useLocation } from "wouter";

// The platform-ops console (/ops/*) is a separate shell for Tafsell staff,
// not a tenant workspace - it deliberately does not go through
// DashboardLayout (which hard-assumes a tenant user with an organization).
function App() {
  const [location] = useLocation();
  const isOpsRoute = location === "/ops" || location.startsWith("/ops/");
  return <ErrorBoundary><ThemeProvider defaultTheme="light"><LanguageProvider><TooltipProvider><Toaster />{isOpsRoute ? <OpsApp /> : <OfflineSyncProvider><DashboardLayout><Switch><Route path="/" component={() => <ErpWorkspace section="dashboard" />} /><Route path="/customers" component={CustomerMaintenance} /><Route path="/inventory" component={() => <ErpWorkspace section="inventory" />} /><Route path="/tailoring" component={TailoringOrders} /><Route path="/sales" component={PointOfSale} /><Route path="/sales-history" component={SalesHistory} /><Route path="/invoices" component={() => <ErpWorkspace section="invoices" />} /><Route path="/team" component={WorkforceHub} /><Route path="/settings" component={OwnerSettings} /><Route path="/audit" component={() => <ErpWorkspace section="audit" />} /><Route component={NotFound} /></Switch></DashboardLayout></OfflineSyncProvider>}</TooltipProvider></LanguageProvider></ThemeProvider></ErrorBoundary>;
}
export default App;
