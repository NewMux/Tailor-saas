import { createContext, useCallback, useContext, useRef, useState } from "react";
import { toast } from "sonner";
import { authApi } from "@/lib/auth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** The server asks for a recent password confirmation with this code in the error message. */
const REAUTH_MARKER = "(10006)";

export const isReauthError = (error: unknown) => typeof (error as { message?: unknown })?.message === "string" && (error as { message: string }).message.includes(REAUTH_MARKER);

type ReauthContextValue = {
  /** Returns true when the error was a password-confirmation request; `retry` runs once confirmed. */
  handleError: (error: unknown, retry: () => void) => boolean;
};

const ReauthContext = createContext<ReauthContextValue>({ handleError: () => false });

export const useReauth = () => useContext(ReauthContext);

/** Asks for the password when a high-risk action needs a fresh confirmation, then repeats the action. */
export function ReauthProvider({ children }: { children: React.ReactNode }) {
  const utils = trpc.useUtils();
  const retryRef = useRef<(() => void) | null>(null);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const handleError = useCallback((error: unknown, retry: () => void) => {
    if (!isReauthError(error)) return false;
    retryRef.current = retry;
    setPassword("");
    setOpen(true);
    return true;
  }, []);

  const confirm = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await authApi.reauth(password);
      await utils.auth.me.invalidate();
      setOpen(false);
      const retry = retryRef.current;
      retryRef.current = null;
      retry?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That password was not accepted.");
    } finally {
      setBusy(false);
      setPassword("");
    }
  };

  return (
    <ReauthContext.Provider value={{ handleError }}>
      {children}
      <Dialog open={open} onOpenChange={next => { setOpen(next); if (!next) retryRef.current = null; }}>
        <DialogContent className="sm:max-w-sm">
          <form onSubmit={confirm} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Confirm your password</DialogTitle>
              <DialogDescription>This action needs a recent confirmation. Enter your password to continue.</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="reauth-password">Password</Label>
              <Input id="reauth-password" type="password" autoComplete="current-password" autoFocus value={password} onChange={event => setPassword(event.target.value)} required />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={busy || !password}>Confirm</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </ReauthContext.Provider>
  );
}
