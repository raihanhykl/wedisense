"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Flashlight, FlashlightOff, RefreshCw, ZoomIn } from "lucide-react";
import { useBarcodeScan, type ScanMode } from "@/hooks/use-barcode-scan";
import {
  acquireScreenWakeLock,
  releaseScreenWakeLock,
} from "@/lib/scan-feedback";
import { cn } from "@/lib/utils";

interface BarcodeScannerProps {
  onScan: (value: string) => void;
  onClose: () => void;
  /** Optional recovery action — when present, the camera error overlay
   *  surfaces an "Enter manually" button that closes the scanner and
   *  invokes this. The scan page wires it to a text-input modal. */
  onManualEntry?: () => void;
  /** Scan mode — defaults to 'single' (legacy behaviour: stop after one
   *  decode). 'continuous' keeps the camera open and emits each decode
   *  via onScan; the consumer is responsible for cart bookkeeping. */
  mode?: ScanMode;
  /** Number of items already collected in the batch — drives the badge.
   *  Only meaningful in continuous mode. */
  batchCount?: number;
}

// Duration of the green "captured" flash overlay after a successful decode.
// Slightly longer than the audio beep (150ms) so the visual reads as the
// dominant confirmation signal. The hook releases the camera in the same
// tick as the decode; this is purely cosmetic.
const FLASH_DURATION_MS = 400;

export default function BarcodeScanner({
  onScan,
  onClose,
  onManualEntry,
  mode = "single",
  batchCount = 0,
}: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const {
    startScanning,
    stopScanning,
    isScanning,
    lastResult,
    error,
    capabilities,
    torchOn,
    toggleTorch,
    zoom,
    setZoom,
    switchCamera,
  } = useBarcodeScan();
  // Brief visual "captured" state — pulses corner markers green for
  // FLASH_DURATION_MS after a decode. Independent of the audio/haptic
  // signals which the hook fires.
  const [justDecoded, setJustDecoded] = useState(false);

  const handleStart = useCallback(async () => {
    if (videoRef.current) {
      // In continuous mode each accepted decode fires onContinuousDecode
      // and the camera stays open. We funnel both modes into the same
      // `onScan` consumer prop so the scan page doesn't care about the
      // mode-specific plumbing — only the parent's cart state tracks.
      await startScanning(videoRef.current, {
        mode,
        onContinuousDecode:
          mode === "continuous" ? (value) => onScan(value) : undefined,
      });
    }
  }, [startScanning, mode, onScan]);

  // Auto-start camera on mount, stop on unmount. Belt-and-suspenders: the
  // hook itself releases resources on unmount, but wiring this explicitly
  // here too means a future refactor that swaps the hook can't silently
  // regress the camera-indicator bug.
  useEffect(() => {
    void handleStart();
    return () => {
      stopScanning();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hold a screen wake lock for the duration of the scanner overlay.
  // Browsers release wake locks automatically when the tab goes to
  // background, so we re-acquire on visibility-return — important for
  // audit walkthroughs that take longer than the typical OS sleep timer.
  useEffect(() => {
    void acquireScreenWakeLock();
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void acquireScreenWakeLock();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      void releaseScreenWakeLock();
    };
  }, []);

  // Relay result to parent + flash the visual confirmation. The hook
  // already fired audio + haptic in the same tick as the decode; this
  // flash is the third feedback channel for muted/silent devices.
  useEffect(() => {
    if (!lastResult) return;
    setJustDecoded(true);
    const t = setTimeout(() => setJustDecoded(false), FLASH_DURATION_MS);
    onScan(lastResult);
    return () => clearTimeout(t);
  }, [lastResult, onScan]);

  const handleClose = () => {
    stopScanning();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black">
      {/* Video feed */}
      <video
        ref={videoRef}
        className="h-full w-full object-cover"
        autoPlay
        playsInline
        muted
      />

      {/* Scanning overlay */}
      {(isScanning || justDecoded) && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          {/* Dimmed edges */}
          <div
            className={cn(
              "absolute inset-0 transition-colors duration-150",
              justDecoded ? "bg-green-500/20" : "bg-black/40",
            )}
          />
          {/* Clear center box */}
          <div
            className={cn(
              "relative h-64 w-64 transition-transform duration-200 sm:h-72 sm:w-72",
              justDecoded && "scale-95",
            )}
          >
            <div className="absolute inset-0 bg-transparent" />
            {/* Corner markers — green pulse on decode, white when idle. */}
            {(["lt", "rt", "lb", "rb"] as const).map((corner) => (
              <span
                key={corner}
                className={cn(
                  "absolute h-8 w-8 transition-colors duration-150",
                  corner === "lt" && "left-0 top-0 border-l-4 border-t-4",
                  corner === "rt" && "right-0 top-0 border-r-4 border-t-4",
                  corner === "lb" && "bottom-0 left-0 border-b-4 border-l-4",
                  corner === "rb" && "bottom-0 right-0 border-b-4 border-r-4",
                  justDecoded ? "border-green-400" : "border-white",
                )}
              />
            ))}
            {/* Scanning line — animated while waiting, solid green on
                decode (a quick "captured" cue before the overlay unmounts). */}
            <div
              className={cn(
                "absolute left-2 right-2 top-1/2 h-0.5 -translate-y-1/2 transition-colors",
                justDecoded ? "bg-green-300" : "animate-pulse bg-green-400",
              )}
            />
          </div>
          {/* Instruction text */}
          <p className="absolute bottom-32 text-center text-sm text-white">
            {justDecoded ? "Captured" : "Align barcode within the frame"}
          </p>
        </div>
      )}

      {/* Error state — kind-aware recovery. Each error kind gets a primary
          CTA tailored to what the user can actually do: settings deeplink
          hint for permission denial, immediate manual-entry switch for
          missing camera, retry for transient errors. */}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 p-6">
          <div className="w-full max-w-sm rounded-lg bg-card p-6 text-center text-card-foreground">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="mx-auto mb-3 h-12 w-12 text-destructive"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4c-.77-1.33-2.69-1.33-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z"
              />
            </svg>
            <p className="mb-4 text-sm font-medium">{error.message}</p>

            {/* Kind-specific recovery hint. Stops short of opening browser
                settings programmatically (no cross-browser API for that) —
                we tell the user what to do and offer the fallback. */}
            {error.kind === "permission-denied" && (
              <p className="mb-4 text-xs text-muted-foreground">
                In most browsers: click the camera icon next to the address
                bar to re-enable.
              </p>
            )}
            {error.kind === "camera-in-use" && (
              <p className="mb-4 text-xs text-muted-foreground">
                Close any other tabs or apps using the camera (e.g., video
                calls), then try again.
              </p>
            )}
            {error.kind === "insecure-context" && (
              <p className="mb-4 text-xs text-muted-foreground">
                getUserMedia requires HTTPS. Ask your admin to enable it.
              </p>
            )}

            <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
              {onManualEntry && (
                <button
                  onClick={() => {
                    stopScanning();
                    onManualEntry();
                  }}
                  className={cn(
                    "rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground",
                    "hover:bg-primary/90 transition-colors",
                  )}
                >
                  Enter manually
                </button>
              )}
              <button
                onClick={handleClose}
                className={cn(
                  "rounded-md border px-4 py-2 text-sm font-medium",
                  "hover:bg-accent transition-colors",
                )}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top action bar — camera controls + close. Feature-gated: each
          button renders only when the active track advertises support.
          Sits inside safe-area-inset so notched phones don't clip it. */}
      {isScanning && (
        <div
          className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between gap-2 px-4 pt-4"
          style={{ paddingTop: "max(1rem, env(safe-area-inset-top))" }}
        >
          {/* Left cluster: torch + switch camera. Empty span keeps close
              button right-aligned when no controls supported. */}
          <div className="flex items-center gap-2">
            {capabilities.torch && (
              <button
                type="button"
                onClick={() => void toggleTorch()}
                aria-label={torchOn ? "Turn flashlight off" : "Turn flashlight on"}
                aria-pressed={torchOn}
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-full backdrop-blur-sm transition-colors",
                  torchOn
                    ? "bg-yellow-400/90 text-black hover:bg-yellow-400"
                    : "bg-black/60 text-white hover:bg-black/80",
                )}
              >
                {torchOn ? (
                  <FlashlightOff className="h-5 w-5" />
                ) : (
                  <Flashlight className="h-5 w-5" />
                )}
              </button>
            )}
            {capabilities.multipleCameras && (
              <button
                type="button"
                onClick={() => void switchCamera()}
                aria-label="Switch camera"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm hover:bg-black/80"
              >
                <RefreshCw className="h-5 w-5" />
              </button>
            )}
          </div>

          <button
            onClick={handleClose}
            className={cn(
              "flex h-10 w-10 items-center justify-center",
              "rounded-full bg-black/60 text-white backdrop-blur-sm",
              "hover:bg-black/80 transition-colors",
            )}
            aria-label="Close scanner"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      )}

      {/* Bottom zoom slider — Chrome Android exposes track.zoom; iOS Safari
          does not, so the slider hides on those devices. Lives outside the
          isScanning block so a residual idle render doesn't strip the safe
          area on switchCamera transitions. */}
      {isScanning && capabilities.zoom && (
        <div
          className="absolute left-0 right-0 bottom-16 z-10 mx-auto flex max-w-xs items-center gap-3 rounded-full bg-black/60 px-4 py-2 backdrop-blur-sm"
          style={{ marginBottom: "max(0px, env(safe-area-inset-bottom))" }}
        >
          <ZoomIn className="h-4 w-4 shrink-0 text-white" />
          <input
            type="range"
            min={capabilities.zoom.min}
            max={capabilities.zoom.max}
            step={capabilities.zoom.step}
            value={zoom}
            onChange={(e) => void setZoom(Number(e.target.value))}
            aria-label="Zoom"
            className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-white/30 accent-white"
          />
          <span className="w-8 shrink-0 text-right text-xs font-medium text-white">
            {zoom.toFixed(1)}×
          </span>
        </div>
      )}

      {/* Batch-mode footer — only in continuous mode. Shows the running
          count + a Done button that closes the scanner so the consumer
          can surface the batch action sheet. We piggyback on onClose
          because closing the overlay IS the "commit" step from the
          scanner's POV; cart state lives outside this component. */}
      {isScanning && mode === "continuous" && (
        <div
          className="absolute bottom-6 left-0 right-0 z-10 flex items-center justify-center px-4"
          style={{ marginBottom: "max(0px, env(safe-area-inset-bottom))" }}
        >
          <button
            type="button"
            onClick={handleClose}
            className={cn(
              "inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-medium shadow-lg transition-colors",
              batchCount > 0
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-white/90 text-black hover:bg-white",
            )}
          >
            <Check className="h-4 w-4" />
            {batchCount > 0
              ? `Done · ${batchCount} item${batchCount === 1 ? "" : "s"}`
              : "Done"}
          </button>
        </div>
      )}

      {/* Close button — error-state only. The scanning-state close button
          lives in the top action bar above. */}
      {error && !isScanning && (
        <button
          onClick={handleClose}
          className={cn(
            "absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center",
            "rounded-full bg-black/60 text-white backdrop-blur-sm",
            "hover:bg-black/80 transition-colors",
          )}
          style={{ top: "max(1rem, env(safe-area-inset-top))" }}
          aria-label="Close scanner"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      )}
    </div>
  );
}
