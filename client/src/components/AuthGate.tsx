import { authApi } from "@/lib/auth";
import { useLanguage } from "@/contexts/LanguageContext";
import { clientBrand } from "@/lib/branding";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BOOK_DEMO_URL, COMPANY_NAME, COMPANY_URL, MARKETING_SITE_URL, PRODUCT_NAME } from "@shared/const";

type AuthGateProps = {
  callbackError?: string | null;
  recoveryMode?: boolean;
  resetToken?: string | null;
  onRecoveryComplete?: () => Promise<void> | void;
  inviteToken?: string | null;
  onInviteAccepted?: () => void;
};

export default function AuthGate({ callbackError, recoveryMode = false, resetToken, onRecoveryComplete, inviteToken, onInviteAccepted }: AuthGateProps) {
  const [mode, setMode] = useState<"login" | "register" | "forgot">(inviteToken ? "register" : "login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [recoveryConfirmation, setRecoveryConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [inviteEmail, setInviteEmail] = useState<string | null>(null);
  const [inviteShopName, setInviteShopName] = useState<string | null>(null);
  const { isArabic, toggleLanguage } = useLanguage();
  const [, navigate] = useLocation();

  // An invite can only be accepted with the address it was sent to, so fill
  // that address in and lock the field rather than letting the person type
  // a different one and hit a server-side rejection.
  useEffect(() => {
    if (!inviteToken) return;
    let cancelled = false;
    authApi
      .inviteDetails(inviteToken)
      .then(details => {
        if (cancelled) return;
        setInviteEmail(details.email);
        setInviteShopName(details.shopName);
        setEmail(details.email);
        setName(current => current || details.name);
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : "This invite link is invalid or has expired.");
      });
    return () => {
      cancelled = true;
    };
  }, [inviteToken]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setPending(true);

    try {
      if (recoveryMode) {
        if (!resetToken) throw new Error("This password reset link is invalid or expired.");
        if (recoveryPassword !== recoveryConfirmation) {
          setError("The passwords do not match.");
          return;
        }
        await authApi.reset(resetToken, recoveryPassword);
        setNotice("Password updated. Opening your ERP workspace…");
        await onRecoveryComplete?.();
        navigate("/");
        return;
      }

      if (mode === "forgot") {
        const response = await authApi.forgot(email);
        setNotice(response.resetUrl ? `Reset link created for local testing: ${response.resetUrl}` : response.message);
        setMode("login");
      } else if (mode === "login") {
        await authApi.login(email, password);
        navigate("/");
      } else if (inviteToken) {
        await authApi.register({ name, email, password, mode: "join_invite", inviteToken });
        onInviteAccepted?.();
        navigate("/");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="stitch-frame relative w-full max-w-md rounded-2xl border bg-white p-10 shadow-sm">
        <Button data-no-translate type="button" variant="outline" size="sm" className="absolute right-7 top-7 rounded-xl" onClick={toggleLanguage}>{isArabic ? "EN" : "عربي"}</Button>
        <img src={clientBrand.logoSrc} alt={clientBrand.logoAlt} className="mx-auto h-14 w-14 object-contain" />
        <h1 className="mt-5 text-center text-2xl font-semibold">
          {recoveryMode ? "Set your password" : mode === "login" ? `Sign in to ${clientBrand.name}` : mode === "forgot" ? "Reset your password" : "Join your team"}
        </h1>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          {recoveryMode
            ? "Choose a password to finish setting up your account and enter the ERP workspace."
            : mode === "login"
              ? "Use the email and password set up for your staff account."
              : mode === "forgot"
                ? "Enter your staff email and request a secure reset link."
                : inviteShopName
                  ? `You're accepting a staff invite to ${inviteShopName}. Create your account to join its workspace.`
                  : "You're accepting a staff invite. Create your account to join this shop's workspace."}
        </p>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          {recoveryMode ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="recovery-password">New password</Label>
                <Input
                  id="recovery-password"
                  type="password"
                  value={recoveryPassword}
                  onChange={e => setRecoveryPassword(e.target.value)}
                  required
                  minLength={8}
                  maxLength={200}
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="recovery-confirmation">Confirm new password</Label>
                <Input
                  id="recovery-confirmation"
                  type="password"
                  value={recoveryConfirmation}
                  onChange={e => setRecoveryConfirmation(e.target.value)}
                  required
                  minLength={8}
                  maxLength={200}
                  autoComplete="new-password"
                />
              </div>
            </>
          ) : (
            <>
              {mode === "register" && (
                <div className="space-y-1.5">
                  <Label htmlFor="name">Full name</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    required
                    minLength={2}
                    maxLength={160}
                    autoComplete="name"
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  maxLength={320}
                  autoComplete="email"
                  readOnly={mode === "register" && Boolean(inviteEmail)}
                />
              </div>
              {mode !== "forgot" && <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  minLength={8}
                  maxLength={200}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                />
              </div>}
            </>
          )}

          {!recoveryMode && callbackError && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm leading-5 text-amber-950">{callbackError}</div>}
          {notice && <p className="break-words text-sm text-emerald-600">{notice}</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" className="w-full" disabled={pending}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {recoveryMode ? "Save password" : mode === "login" ? "Sign in" : mode === "forgot" ? "Send reset link" : "Create account"}
          </Button>
        </form>

        {!recoveryMode && <div className="mt-5 space-y-2 text-center text-sm text-muted-foreground">
          {mode === "login" && <button
            type="button"
            className="block w-full underline-offset-4 hover:underline"
            onClick={() => {
              setMode("forgot");
              setError(null);
              setNotice(null);
            }}
          >
            Forgot password?
          </button>}
          {/* Accounts are invite-only: staff join through their shop's invite,
              and new shops are set up by the platform team. */}
          {inviteToken ? (
            <button
              type="button"
              className="block w-full underline-offset-4 hover:underline"
              onClick={() => {
                setMode(mode === "register" ? "login" : "register");
                setError(null);
                setNotice(null);
              }}
            >
              {mode === "register" ? "Already have an account? Sign in" : "Accept your invite instead"}
            </button>
          ) : mode === "forgot" ? (
            <button
              type="button"
              className="block w-full underline-offset-4 hover:underline"
              onClick={() => {
                setMode("login");
                setError(null);
                setNotice(null);
              }}
            >
              Back to sign in
            </button>
          ) : (
            <p>
              New shop?{" "}
              <a href={BOOK_DEMO_URL} className="text-foreground underline-offset-4 hover:underline">
                Book a demo
              </a>
            </p>
          )}
        </div>}
        <nav className="mt-6 flex flex-wrap justify-center gap-x-4 gap-y-1 border-t pt-4 text-xs text-muted-foreground" aria-label="Legal">
          <a href={MARKETING_SITE_URL} className="hover:underline">Home</a>
          <Link href="/pricing" className="hover:underline">Pricing</Link>
          <Link href="/terms" className="hover:underline">Terms</Link>
          <Link href="/privacy" className="hover:underline">Privacy</Link>
        </nav>
        <p className="mt-3 text-center text-[11px] text-muted-foreground" data-no-translate>
          {PRODUCT_NAME}, powered by{" "}
          <a href={COMPANY_URL} target="_blank" rel="noopener" className="font-medium hover:underline">{COMPANY_NAME}</a>
        </p>
      </div>
    </main>
  );
}
