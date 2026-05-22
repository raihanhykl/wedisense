"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { formatMoneyForInput, parseMoneyInput } from "@/lib/utils";
import { getCurrency } from "@/lib/currencies";

// Spec §2.2 — money input that formats on blur so the user can both
// type freely (raw digits + decimal) and see a thousand-separated total
// at rest. The currency code drives the locale of formatMoneyForInput.
//
// Input contract:
//   - `value` is always a CANONICAL string ("12345.67"), the same shape
//     React Hook Form stores. Empty string for "not entered".
//   - On blur we re-format for display. On focus we re-show the raw
//     string so the cursor can edit it directly.
//   - `onChange` fires with the canonical string every keystroke.

interface MoneyInputProps {
  value: string;
  onChange: (next: string) => void;
  currency: string;
  /** Currency symbol shown inside the input (left-pad). Optional —
   *  some callers prefer a sibling badge. */
  showSymbol?: boolean;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  id?: string;
  name?: string;
  className?: string;
  /** When true, the input is bordered red to indicate a validation
   *  error. Consumed by RHF error states. */
  invalid?: boolean;
  /** Fired when the field loses focus AFTER any formatting flip. The
   *  current canonical value is passed back. */
  onBlur?: (next: string) => void;
}

export default function MoneyInput({
  value,
  onChange,
  currency,
  showSymbol = true,
  placeholder,
  disabled,
  readOnly,
  id,
  name,
  className,
  invalid,
  onBlur,
}: MoneyInputProps) {
  // While the field is focused we render the raw canonical string so
  // the user can edit digit-by-digit. On blur we swap to the formatted
  // display. Tracking with local state lets us avoid reformatting on
  // every parent re-render.
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(value);

  // Mirror upstream prop changes into local draft when not focused.
  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);

  const def = getCurrency(currency);
  // Pick a sensible symbol for the prefix. Intl.NumberFormat doesn't
  // expose a clean "symbol only" mode; the parts API gets us there but
  // the symbol changes with locale so we read from a sample format.
  const symbol = (() => {
    if (!showSymbol) return null;
    try {
      const parts = new Intl.NumberFormat(def.locale, {
        style: "currency",
        currency: def.code,
        minimumFractionDigits: def.fractionDigits,
        maximumFractionDigits: def.fractionDigits,
      }).formatToParts(0);
      return parts.find((p) => p.type === "currency")?.value ?? def.code;
    } catch {
      return def.code;
    }
  })();

  const displayed = focused ? draft : formatMoneyForInput(value, currency);

  return (
    <div className={cn("relative", className)}>
      {showSymbol && (
        <span
          className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 select-none text-xs font-medium text-muted-foreground"
          aria-hidden
        >
          {symbol}
        </span>
      )}
      <input
        id={id}
        name={name}
        type="text"
        inputMode="decimal"
        value={displayed}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        onFocus={() => {
          setFocused(true);
          setDraft(value);
        }}
        onBlur={() => {
          setFocused(false);
          if (onBlur) onBlur(value);
        }}
        onChange={(e) => {
          const canonical = parseMoneyInput(e.target.value);
          setDraft(canonical);
          onChange(canonical);
        }}
        className={cn(
          "w-full rounded-md border bg-background py-1.5 pr-3 text-sm outline-none focus:border-primary",
          showSymbol ? "pl-9" : "pl-3",
          invalid && "border-red-500 focus:border-red-600",
          disabled && "cursor-not-allowed opacity-60",
        )}
      />
    </div>
  );
}
