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
import Billing from "./pages/Billing";
import NotFound from "./pages/NotFound";
import { Redirect, Route, Switch } from "wouter";

 function App() { return <ErrorBoundary><ThemeProvider defaultTheme="light"><LanguageProvider><TooltipProvider><Toaster /><OfflineSyncProvider><DashboardLayout><Switch><Route path="/" component={() => <ErpWorkspace section="dashboard" />} /><Route path="/customers" component={CustomerMaintenance} /><Route path="/inventory" component={() => <ErpWorkspace section="inventory" />} /><Route path="/tailoring" component={TailoringOrders} /><Route path="/sales" component={PointOfSale} /><Route path="/sales-history" component={SalesHistory} /><Route path="/invoices" component={() => <ErpWorkspace section="invoices" />} /><Route path="/team" component={WorkforceHub} /><Route path="/settings" component={OwnerSettings} /><Route path="/billing" component={() => <Billing />} /><Route path="/audit" component={() => <ErpWorkspace section="audit" />} /><Route path="/login" component={() => <Redirect to="/" />} /><Route path="/signup" component={() => <Redirect to="/" />} /><Route component={NotFound} /></Switch></DashboardLayout></OfflineSyncProvider></TooltipProvider></LanguageProvider></ThemeProvider></ErrorBoundary>; }
export default App;
