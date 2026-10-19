import { useState } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";

/** Asks for a written reason before a consequential action; the reason goes to the audit trail. */
export function ReasonDialog({ open, title, description, confirmLabel = "Confirm", onCancel, onConfirm }: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <AlertDialog open={open} onOpenChange={next => { if (!next) { setReason(""); onCancel(); } }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <Textarea value={reason} onChange={event => setReason(event.target.value)} placeholder="Reason (required)" maxLength={300} />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={reason.trim().length < 3} onClick={() => { const value = reason.trim(); setReason(""); onConfirm(value); }}>{confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
