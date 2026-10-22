import { Loader2, LogOut, ShieldAlert } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import AuthGate from "@/components/AuthGate";
import { ReauthProvider } from "@/components/ReauthDialog";
import { Button } from "@/components/ui/button";

const navigation = [
  { label: "Organizations", path: "/ops" },
  { label: "Users", path: "/ops/users" },
  { label: "Platform staff", path: "/ops/staff" },
  { label: "Audit", path: "/ops/audit" },
  { label: "Security", path: "/ops/security" },
];

export default function OpsShell({ children }: { children: React.ReactNode }) {
  const { user, loading, isAuthenticated, logout, callbackError, recoveryMode, resetToken, inviteToken, clearInviteToken, completeRecovery } = useAuth();
  const [location] = useLocation();

  if (loading) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="animate-spin text-primary" /></div>;
  if (recoveryMode) return <AuthGate recoveryMode resetToken={resetToken} onRecoveryComplete={completeRecovery} />;
  if (!isAuthenticated) return <AuthGate callbackError={callbackError} inviteToken={inviteToken} onInviteAccepted={clearInviteToken} />;

  if (!user?.isPlatformStaff) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-sm rounded-2xl border bg-white p-6 text-center shadow-sm">
          <ShieldAlert className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-semibold">Not authorized</p>
          <p className="mt-1 text-sm text-muted-foreground">Your account doesn't have platform operator access.</p>
          <Button variant="outline" className="mt-4 w-full" onClick={() => logout()}>Sign out</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background">
      <header className="border-b bg-white px-4 py-3">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
          <p className="text-sm font-semibold">Tafsell Platform Ops</p>
          <nav className="flex flex-wrap gap-1 text-sm">
            {navigation.map(item => (
              <Link
                key={item.path}
                href={item.path}
                className={`rounded-lg px-3 py-1.5 font-medium ${location === item.path ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            {user.organizationId != null && <Link href="/" className="text-sm text-muted-foreground hover:underline">Back to workspace</Link>}
            <Button variant="ghost" size="sm" onClick={() => logout()}><LogOut className="mr-2 h-4 w-4" />Sign out</Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-4 sm:p-6"><ReauthProvider>{children}</ReauthProvider></main>
    </div>
  );
}
