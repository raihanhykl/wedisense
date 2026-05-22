import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { SUPPORTED_CURRENCIES } from "@/lib/currencies";

// Spec §2.2 — dropdown of supported currencies. Reuses the registry in
// lib/currencies so the dropdown's options and the formatter's locale
// table never drift.

interface CurrencySelectProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "children"> {
  /** Display an explicit "All currencies" entry at the top — useful for
   *  filter UIs where the empty string means "any". List forms (create
   *  PO) leave this off so the user always commits to a currency. */
  includeAllOption?: boolean;
}

const CurrencySelect = forwardRef<HTMLSelectElement, CurrencySelectProps>(
  function CurrencySelect({ className, includeAllOption, ...props }, ref) {
    return (
      <select
        ref={ref}
        className={cn(
          "w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary",
          className,
        )}
        {...props}
      >
        {includeAllOption && <option value="">All currencies</option>}
        {SUPPORTED_CURRENCIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.label}
          </option>
        ))}
      </select>
    );
  },
);

export default CurrencySelect;
