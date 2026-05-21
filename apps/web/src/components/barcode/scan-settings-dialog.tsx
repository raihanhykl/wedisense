"use client";

import { useEffect } from "react";
import { Settings, X } from "lucide-react";
import { useScanSettings } from "@/lib/scan-settings";
import { cn } from "@/lib/utils";

interface ScanSettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Per-user scan preferences modal. Two toggles today (sound + vibrate) —
 * room to grow later (default scan mode, batch cooldown, etc.). Writes
 * to localStorage via the useScanSettings hook so changes are immediately
 * picked up by triggerScanFeedback on the next decode.
 */
export default function ScanSettingsDialog({
  open,
  onClose,
}: ScanSettingsDialogProps) {
  const [settings, setSettings] = useScanSettings();

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="scan-settings-title"
    >
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />

      <div className="relative z-10 w-full max-w-sm rounded-lg border bg-card shadow-lg">
        <header className="flex items-center justify-between border-b px-5 py-3">
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-muted-foreground" />
            <h2 id="scan-settings-title" className="text-base font-semibold">
              Scan settings
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-4 px-5 py-4">
          <ToggleRow
            label="Sound"
            description="Play a short beep when a barcode is captured."
            checked={settings.soundEnabled}
            onChange={(v) => setSettings({ ...settings, soundEnabled: v })}
          />
          <ToggleRow
            label="Vibration"
            description="Vibrate the device on capture (Android only)."
            checked={settings.vibrateEnabled}
            onChange={(v) => setSettings({ ...settings, vibrateEnabled: v })}
          />
        </div>

        <footer className="flex justify-end border-t px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}

// ── Inline toggle row ────────────────────────────────────────────────

interface ToggleRowProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}

function ToggleRow({ label, description, checked, onChange }: ToggleRowProps) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-0.5 inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
          checked ? "bg-primary" : "bg-muted",
        )}
      >
        <span
          className={cn(
            "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform",
            checked ? "translate-x-5" : "translate-x-0",
          )}
        />
      </button>
    </div>
  );
}
