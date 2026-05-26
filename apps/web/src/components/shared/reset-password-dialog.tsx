"use client";

import { useEffect, useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { apiPost } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/error";
import PasswordInput from "@/components/shared/password-input";

// Phase 17 v2 — admin-driven password reset dialog.
//
// Two-factor flow at the UI level:
//   1. Admin enters THEIR OWN current password (re-authentication;
//      defence against a hijacked session that already has cookies
//      but doesn't know the admin's real password).
//   2. Admin enters the new password TWICE for the target user.
//
// The backend (POST /api/users/:id/reset-password) does the real
// verification; the dialog just collects + sanity-checks before send.

interface ResetPasswordDialogProps {
  open: boolean;
  /** Target user — null acts as a closed-state placeholder. */
  user: { id: string; name: string; email: string } | null;
  onClose: () => void;
  /** Optional callback after a successful reset (e.g. for analytics
   *  or a parent-level toast). The dialog already toasts on success. */
  onSuccess?: () => void;
}

const MIN_LENGTH = 8;

export default function ResetPasswordDialog({
  open,
  user,
  onClose,
  onSuccess,
}: ResetPasswordDialogProps) {
  const [actorPassword, setActorPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset all inputs whenever the dialog closes or switches user, so a
  // stale entry can never leak across resets. The visibility toggle
  // state is owned per-PasswordInput instance and resets on remount.
  useEffect(() => {
    if (!open) {
      setActorPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setError(null);
    }
  }, [open]);

  if (!open || !user) return null;

  const mismatch =
    confirmPassword.length > 0 && newPassword !== confirmPassword;
  const tooShort = newPassword.length > 0 && newPassword.length < MIN_LENGTH;
  const canSubmit =
    !submitting &&
    actorPassword.length > 0 &&
    newPassword.length >= MIN_LENGTH &&
    confirmPassword === newPassword;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiPost(`/api/users/${user.id}/reset-password`, {
        actorPassword,
        newPassword,
      });
      toast.success(`Password reset for ${user.name}`);
      onSuccess?.();
      onClose();
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to reset password"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="reset-password-title"
    >
      <div
        className="w-full max-w-md rounded-lg bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start gap-3">
          <div className="rounded-full bg-amber-100 p-2 text-amber-700">
            <KeyRound className="h-5 w-5" />
          </div>
          <div>
            <h2 id="reset-password-title" className="text-lg font-semibold">
              Reset password
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Override the password for{" "}
              <span className="font-medium text-foreground">{user.name}</span>{" "}
              ({user.email}). The user will be signed out of any active
              sessions on their next request.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Actor password — re-authentication. autoComplete=current-password
              so password managers know to surface the admin's own creds. */}
          <div>
            <label htmlFor="actorPassword" className="block text-sm font-medium">
              Your current password{" "}
              <span className="text-destructive">*</span>
            </label>
            <div className="mt-1">
              <PasswordInput
                id="actorPassword"
                value={actorPassword}
                onChange={(e) => setActorPassword(e.target.value)}
                autoComplete="current-password"
                disabled={submitting}
              />
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Confirming your identity prevents a hijacked session from
              taking over arbitrary accounts.
            </p>
          </div>

          {/* New password + confirm. autoComplete=new-password so the
              browser's password generator can suggest a strong one. */}
          <div>
            <label htmlFor="newPassword" className="block text-sm font-medium">
              New password for {user.name.split(" ")[0]}{" "}
              <span className="text-destructive">*</span>
            </label>
            <div className="mt-1">
              <PasswordInput
                id="newPassword"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                disabled={submitting}
                invalid={tooShort}
              />
            </div>
            {tooShort && (
              <p className="mt-1 text-[10px] text-red-600">
                Minimum {MIN_LENGTH} characters.
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="confirmPassword"
              className="block text-sm font-medium"
            >
              Confirm new password{" "}
              <span className="text-destructive">*</span>
            </label>
            <div className="mt-1">
              <PasswordInput
                id="confirmPassword"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                disabled={submitting}
                invalid={mismatch}
              />
            </div>
            {mismatch && (
              <p className="mt-1 text-[10px] text-red-600">
                Doesn&apos;t match the new password.
              </p>
            )}
          </div>

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex items-center gap-2 rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Reset password
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
