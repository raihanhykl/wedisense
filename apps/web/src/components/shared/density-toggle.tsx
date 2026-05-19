"use client";

import { Rows3, Rows4, AlignJustify } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Density } from "@/hooks/use-density";

const OPTIONS: Array<{ value: Density; label: string; icon: React.ReactNode }> = [
  // Order: compact → normal → spacious left-to-right, matching the visual
  // intuition that a denser row is "shorter".
  { value: "compact", label: "Compact", icon: <Rows4 className="h-4 w-4" /> },
  { value: "normal", label: "Normal", icon: <Rows3 className="h-4 w-4" /> },
  { value: "spacious", label: "Spacious", icon: <AlignJustify className="h-4 w-4" /> },
];

interface DensityToggleProps {
  value: Density;
  onChange: (next: Density) => void;
}

export default function DensityToggle({ value, onChange }: DensityToggleProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Row density"
      className="inline-flex shrink-0 rounded-md border bg-card p-0.5"
    >
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          aria-label={opt.label}
          title={opt.label}
          onClick={() => onChange(opt.value)}
          className={cn(
            "flex items-center justify-center rounded-sm p-1.5 transition-colors",
            value === opt.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {opt.icon}
        </button>
      ))}
    </div>
  );
}
