"use client";

import { forwardRef, useState } from "react";
import type { InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

// Shared password input with show/hide toggle. Drop-in replacement for
// any <input type="password" />. The toggle button:
//   - lives inside the field on the right, doesn't shift surrounding
//     layout
//   - tabIndex=-1 so it doesn't grab focus during Tab navigation
//     between form fields — the user types pw → Tab → goes straight
//     to the next field (clicking the eye is mouse-only)
//   - swaps between Eye / EyeOff icons; aria-label updates to match
//     so screen readers announce the current action
//
// `type` is the only attribute we override — everything else
// (autoComplete, disabled, value, onChange, placeholder, className…)
// passes through unchanged so callers can wire React Hook Form +
// password-manager hints exactly as before.

interface PasswordInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** Visual error state — adds a red border. Cheaper than threading
   *  a full error string through; callers usually render the message
   *  themselves outside the input. */
  invalid?: boolean;
}

const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ className, invalid, ...rest }, ref) {
    const [show, setShow] = useState(false);
    return (
      <div className="relative">
        <input
          ref={ref}
          type={show ? "text" : "password"}
          className={cn(
            // Default field styling matches the app's existing inputs;
            // the right padding makes room for the toggle button so the
            // cursor never collides with the icon.
            "w-full rounded-md border bg-background px-3 py-1.5 pr-9 text-sm outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50",
            invalid && "border-red-500 focus:border-red-600",
            className,
          )}
          {...rest}
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          tabIndex={-1}
          aria-label={show ? "Hide password" : "Show password"}
          aria-pressed={show}
          className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
        >
          {show ? (
            <EyeOff className="h-3.5 w-3.5" />
          ) : (
            <Eye className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
    );
  },
);

export default PasswordInput;
