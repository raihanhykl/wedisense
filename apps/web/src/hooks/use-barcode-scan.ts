"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BrowserMultiFormatReader,
  type IScannerControls,
} from "@zxing/browser";
import {
  NotFoundException,
  BarcodeFormat,
  DecodeHintType,
} from "@zxing/library";
import { triggerScanFeedback } from "@/lib/scan-feedback";

// Suppress identical decodes within this window. ZXing fires the result
// callback every frame the barcode stays in view — without a cooldown a
// single physical scan becomes dozens of duplicate state transitions.
// Kept around for future continuous/batch mode (Tier 6); for the current
// single-shot flow the `capturedRef` one-shot guard is the primary defense.
const DUPLICATE_SUPPRESSION_MS = 1200;

/**
 * Map a getUserMedia/decodeFromStream rejection to a discriminated
 * ScannerError so the UI can route to the right recovery path. Standard
 * DOMException.name values are consistent across Chrome/Firefox/Safari;
 * non-standard errors fall through to `generic`.
 */
function classifyScannerError(err: unknown): ScannerError {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    // Plain http (outside localhost) — getUserMedia silently rejects.
    // Surface a clearer message than the browser would.
    return {
      kind: "insecure-context",
      message:
        "Camera requires HTTPS. Open this page over a secure connection or use manual entry.",
    };
  }
  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices ||
    typeof navigator.mediaDevices.getUserMedia !== "function"
  ) {
    return {
      kind: "unsupported",
      message:
        "Camera scanning is not supported in this browser. Use manual entry instead.",
    };
  }
  if (err instanceof DOMException) {
    switch (err.name) {
      case "NotAllowedError":
      case "SecurityError":
        return {
          kind: "permission-denied",
          message:
            "Camera permission denied. Allow camera access in your browser settings, then try again.",
        };
      case "NotFoundError":
      case "OverconstrainedError":
        return {
          kind: "no-camera",
          message:
            "No camera detected on this device. Use manual entry instead.",
        };
      case "NotReadableError":
      case "AbortError":
        return {
          kind: "camera-in-use",
          message:
            "Camera is in use by another tab or application. Close it and try again.",
        };
    }
  }
  return {
    kind: "generic",
    message:
      err instanceof Error ? err.message : "Failed to start camera.",
  };
}

/**
 * Discriminated error kinds so the UI can offer the right recovery path:
 *
 *   - `permission-denied`  → user said no (or browser blocked). Show
 *     settings deeplink + manual entry fallback.
 *   - `no-camera`          → no camera hardware. Auto-switch to manual entry.
 *   - `camera-in-use`      → another tab/app holds it. Hint "close other tabs".
 *   - `insecure-context`   → page served over plain http (no getUserMedia).
 *   - `unsupported`        → getUserMedia not available at all.
 *   - `generic`            → catch-all. Show message + manual entry.
 *
 * Mapping comes from DOMException.name on the getUserMedia rejection;
 * Chrome/Firefox/Safari are consistent on the standard names.
 */
export type ScannerErrorKind =
  | "permission-denied"
  | "no-camera"
  | "camera-in-use"
  | "insecure-context"
  | "unsupported"
  | "generic";

export interface ScannerError {
  kind: ScannerErrorKind;
  /** Short human message safe to render in the UI as-is. */
  message: string;
}

/**
 * Runtime camera capabilities discovered from the active MediaStreamTrack.
 * Non-standard properties (torch, zoom) are advertised inconsistently
 * across browsers — feature-detect everywhere before rendering controls.
 */
export interface ScannerCapabilities {
  /** Hardware flashlight present + controllable. Falsy on iOS Safari. */
  torch: boolean;
  /** Continuous zoom range. null when unsupported (Safari, most desktops). */
  zoom: { min: number; max: number; step: number } | null;
  /** ≥2 video input devices available (front + back). */
  multipleCameras: boolean;
}

type FacingMode = "environment" | "user";

/**
 * Scan modes:
 *   - `single` (default): camera stops after the first accepted decode,
 *     value lands in `lastResult` for the consumer's useEffect. Matches
 *     legacy behaviour — no breaking change for callers that don't opt in.
 *   - `continuous`: camera stays open after each decode. Each accepted
 *     value fires `onContinuousDecode(value)` instead of setting
 *     lastResult. Duplicate suppression's same-value cooldown (1.2s)
 *     prevents the same physical scan from registering twice; tearing the
 *     code out of frame and re-presenting fires a new decode.
 */
export type ScanMode = "single" | "continuous";

export interface StartScanOptions {
  mode?: ScanMode;
  /** Required when mode='continuous'. Called once per accepted decode.
   *  Same value fires only after the cooldown window. */
  onContinuousDecode?: (value: string) => void;
}

interface UseBarcodeScanReturn {
  startScanning: (
    videoElement: HTMLVideoElement,
    options?: StartScanOptions,
  ) => Promise<void>;
  stopScanning: () => void;
  isScanning: boolean;
  lastResult: string | null;
  error: ScannerError | null;
  /** Capabilities of the currently active track. Empty defaults until
   *  startScanning succeeds; consumers should feature-gate their UI on
   *  these flags rather than guessing per platform. */
  capabilities: ScannerCapabilities;
  /** Current torch state — always false when capabilities.torch is false. */
  torchOn: boolean;
  /** Toggle the flashlight. No-op if not supported. */
  toggleTorch: () => Promise<void>;
  /** Current zoom value within `capabilities.zoom` range; 1 when unsupported. */
  zoom: number;
  /** Set zoom. No-op if outside the supported range. */
  setZoom: (value: number) => Promise<void>;
  /** Whether the back camera is currently in use. */
  facingMode: FacingMode;
  /** Restart the stream with the opposite facing mode. */
  switchCamera: () => Promise<void>;
}

/**
 * Wraps @zxing/browser with explicit MediaStream ownership.
 *
 * The library accepts either constraints (it acquires the stream itself) or a
 * pre-acquired stream. We use the latter so the underlying `MediaStream`
 * lives in OUR ref — not in the library's private closure. This matters for
 * cleanup: when the user navigates away while a scan is in-flight, we can
 * call `track.stop()` directly even if the library's `controls` object
 * hasn't been assigned yet (race the previous implementation tripped on,
 * where the result callback fired before `decodeFromConstraints` had even
 * returned the controls).
 *
 * Three lifecycle paths converge on the same teardown:
 *   - explicit `stopScanning()` (e.g. user clicks the X button)
 *   - the hook's unmount cleanup (route change, conditional unmount)
 *   - a successful scan calling `stopScanning()` from inside the result callback
 */
// Extend MediaTrackCapabilities with the non-standard properties we care
// about. The DOM lib doesn't include them — torch + zoom shipped via
// W3C Image Capture and Media Capture extensions and remain partial. We
// only cast at the boundary, never expose `unknown` to consumers.
interface ExtendedMediaTrackCapabilities extends MediaTrackCapabilities {
  torch?: boolean;
  zoom?: { min: number; max: number; step: number };
}

interface ExtendedMediaTrackConstraintSet extends MediaTrackConstraintSet {
  torch?: boolean;
  zoom?: number;
}

const NO_CAPABILITIES: ScannerCapabilities = {
  torch: false,
  zoom: null,
  multipleCameras: false,
};

export function useBarcodeScan(): UseBarcodeScanReturn {
  const [isScanning, setIsScanning] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [error, setError] = useState<ScannerError | null>(null);
  // Capabilities + control state — populated when a stream is acquired,
  // reset on teardown. Held as state (not refs) so the UI re-renders
  // when controls become available.
  const [capabilities, setCapabilities] =
    useState<ScannerCapabilities>(NO_CAPABILITIES);
  const [torchOn, setTorchOn] = useState(false);
  const [zoom, setZoomState] = useState(1);
  const [facingMode, setFacingMode] = useState<FacingMode>("environment");

  // Library's scan controller (returned by decodeFromStream).
  const controlsRef = useRef<IScannerControls | null>(null);
  // The MediaStream we acquired via getUserMedia. We own this, so stopping
  // its tracks is the reliable way to release the camera.
  const streamRef = useRef<MediaStream | null>(null);
  // The <video> element we bound the stream to — we clear its srcObject on
  // teardown so the browser releases its grip too.
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // The zxing reader instance.
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  // Last-decoded value + timestamp for duplicate suppression. Held in a ref
  // (not state) so the decode callback can read+update synchronously
  // without React's batching pushing the next decode through too early.
  const lastDecodedRef = useRef<{ value: string; ts: number }>({
    value: "",
    ts: 0,
  });
  // One-shot capture guard. ZXing's callback is registered before
  // `controlsRef.current` is assigned, so a fast first frame could decode
  // before releaseResources() can call controls.stop(). Even after stop()
  // is called, a few queued callbacks may still fire. This flag flips to
  // true the instant a decode is accepted and short-circuits every
  // subsequent callback for the session — independent of the text-equality
  // check, which can fail if zxing returns slightly different strings per
  // frame (whitespace, partial decode artefacts). Reset in startScanning.
  const capturedRef = useRef(false);
  // Mode for the current session — read by the decode callback to choose
  // single-shot (release + setLastResult) vs continuous (callback + keep
  // camera open). Reset in startScanning.
  const modeRef = useRef<ScanMode>("single");
  // Callback for continuous mode. Closure-captured in the decode handler
  // so we can fire it without prop-drilling through React state.
  const onContinuousDecodeRef = useRef<((value: string) => void) | null>(null);
  // Current facing mode held in a ref so switchCamera can flip it
  // synchronously before re-acquiring the stream. The state mirror exists
  // only to drive UI re-renders (e.g. button toggle icons).
  const facingModeRef = useRef<FacingMode>("environment");
  // Preserved across teardown so switchCamera knows which <video> element
  // to bind the new stream to. videoRef.current is nulled on release; this
  // one persists for the lifetime of the scanning session.
  const lastVideoElementRef = useRef<HTMLVideoElement | null>(null);
  // The active video track for the current stream. Held in a ref so the
  // control methods (toggleTorch, setZoom) can apply constraints without
  // a state-read race. Cleared on release.
  const activeTrackRef = useRef<MediaStreamTrack | null>(null);

  // Idempotent full teardown. Called from three places (see hook doc).
  // Always:
  //  1. ask zxing to stop its scan loop (if it ever started),
  //  2. stop every track on our captured stream,
  //  3. detach the stream from the <video> element,
  //  4. clear capability/control state so the UI hides camera-control
  //     widgets while no stream is active.
  // Each step guarded so a partial init still tears down cleanly.
  const releaseResources = useCallback(() => {
    if (controlsRef.current) {
      try {
        controlsRef.current.stop();
      } catch {
        // Library may throw if already stopped — ignore.
      }
      controlsRef.current = null;
    }
    if (streamRef.current) {
      // This is the line that actually turns the camera indicator off.
      // Without it, the MediaStream is GC'd eventually but the OS keeps
      // the indicator lit until the GC runs.
      for (const track of streamRef.current.getTracks()) {
        try {
          track.stop();
        } catch {
          // Track may be already stopped — ignore.
        }
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      try {
        videoRef.current.srcObject = null;
      } catch {
        // Element may have been removed from the DOM — ignore.
      }
      videoRef.current = null;
    }
    activeTrackRef.current = null;
    // Reset control surface — capabilities are stream-specific; torch
    // off when no track to apply to; zoom back to neutral baseline.
    setCapabilities(NO_CAPABILITIES);
    setTorchOn(false);
    setZoomState(1);
  }, []);

  const stopScanning = useCallback(() => {
    releaseResources();
    setIsScanning(false);
  }, [releaseResources]);

  const startScanning = useCallback(
    async (videoElement: HTMLVideoElement, options?: StartScanOptions) => {
      setError(null);
      setLastResult(null);
      // Reset both suppression flags at session boundary so the user can
      // re-scan the same code by opening the scanner again.
      lastDecodedRef.current = { value: "", ts: 0 };
      capturedRef.current = false;
      // Mode + continuous callback are captured in refs so the decode
      // callback (which closes over them) gets the current values without
      // re-binding the zxing handler.
      modeRef.current = options?.mode ?? "single";
      onContinuousDecodeRef.current = options?.onContinuousDecode ?? null;

      // Defensive: if a previous start is still wired up, tear it down first.
      releaseResources();

      // Track the element early so the cleanup path can null its srcObject
      // even if zxing throws before binding. Also preserve in a longer-
      // lived ref so switchCamera can re-bind after teardown.
      videoRef.current = videoElement;
      lastVideoElementRef.current = videoElement;

      try {
        if (!readerRef.current) {
          const hints = new Map<DecodeHintType, unknown>();
          hints.set(DecodeHintType.POSSIBLE_FORMATS, [
            BarcodeFormat.CODE_128,
            BarcodeFormat.CODE_39,
            BarcodeFormat.EAN_13,
            BarcodeFormat.EAN_8,
            BarcodeFormat.UPC_A,
            BarcodeFormat.UPC_E,
            BarcodeFormat.QR_CODE,
            BarcodeFormat.DATA_MATRIX,
          ]);
          hints.set(DecodeHintType.TRY_HARDER, true);
          readerRef.current = new BrowserMultiFormatReader(hints);
        }

        // Acquire the stream ourselves so we own its lifecycle. The facing
        // mode is read from the ref so switchCamera can flip it before
        // calling back into startScanning.
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: facingModeRef.current,
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        });
        streamRef.current = stream;

        // Capability detection — read once now, expose to the UI. Track
        // also stored separately so toggleTorch / setZoom can applyConstraints
        // without walking through streamRef.
        const [track] = stream.getVideoTracks();
        if (track) {
          activeTrackRef.current = track;
          const caps =
            (typeof track.getCapabilities === "function"
              ? (track.getCapabilities() as ExtendedMediaTrackCapabilities)
              : undefined) ?? {};
          // Enumerate devices to know whether the camera-switch button is
          // worth showing. Permission has been granted by this point, so
          // the labels/IDs are populated. Treat enumeration failure as
          // "single camera" — conservative default hides the button.
          let multipleCameras = false;
          try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            multipleCameras =
              devices.filter((d) => d.kind === "videoinput").length > 1;
          } catch {
            multipleCameras = false;
          }
          setCapabilities({
            torch: caps.torch === true,
            zoom: caps.zoom
              ? { min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step }
              : null,
            multipleCameras,
          });
          // Reset control state to match new track's defaults.
          setTorchOn(false);
          setZoomState(caps.zoom?.min ?? 1);
        }

        // If the component unmounted (or stopScanning was called) WHILE we
        // were waiting for getUserMedia, releaseResources has already nulled
        // streamRef. Detect that and tear down immediately — don't hand the
        // freshly-acquired stream to zxing.
        if (streamRef.current !== stream) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }

        // Holds the controls reference inside the callback's closure. The
        // outer `controlsRef.current = controls` assignment happens only
        // AFTER decodeFromStream resolves — but the callback might fire
        // on its very first frame in between. Capturing locally guarantees
        // we can call stop() the instant we accept a decode, regardless
        // of ref-assignment timing.
        let localControls: IScannerControls | null = null;
        const controls = await readerRef.current.decodeFromStream(
          stream,
          videoElement,
          (result, decodeError) => {
            // One-shot guard. Once we've accepted a decode for this
            // session, ignore every subsequent callback — they're either
            // duplicates of the same physical barcode (ZXing keeps firing
            // per frame) or queued callbacks delivered after stop() but
            // before the loop fully halts. The text-equality + cooldown
            // check below is a secondary defense for the (future)
            // continuous-mode path; this hard guard handles single-shot.
            if (capturedRef.current) return;

            if (result) {
              const text = result.getText().trim();
              const now = Date.now();
              // Secondary suppression — same-value cooldown. Kept for the
              // Tier 6 continuous-mode path; redundant with capturedRef
              // for the current single-shot flow but cheap.
              if (
                text === lastDecodedRef.current.value &&
                now - lastDecodedRef.current.ts < DUPLICATE_SUPPRESSION_MS
              ) {
                return;
              }
              // Flip the guard FIRST so any racing callback that's
              // already mid-flight bails out at the check above.
              capturedRef.current = true;
              lastDecodedRef.current = { value: text, ts: now };

              // Halt the decode loop synchronously via the closure-held
              // reference. Don't rely on controlsRef.current being set —
              // it might not be yet on a fast first frame.
              try {
                localControls?.stop();
              } catch {
                // Already stopped — ignore.
              }

              // Fire multimodal confirmation in the SAME tick as the
              // decode so the user gets immediate physical-capture
              // feedback before any downstream API resolution runs.
              triggerScanFeedback();

              if (modeRef.current === "continuous") {
                // Batch mode: keep camera live, surface the value via
                // callback (consumer pushes to a cart), and release the
                // capture guard after the same-value cooldown window so
                // a *different* code can fire immediately while a repeat
                // of the same physical scan is suppressed.
                onContinuousDecodeRef.current?.(text);
                setTimeout(() => {
                  capturedRef.current = false;
                }, DUPLICATE_SUPPRESSION_MS);
              } else {
                setLastResult(text);
                // Caller will typically unmount us in response, but
                // tearing down preemptively means the camera indicator
                // turns off *now* instead of waiting for the unmount.
                releaseResources();
                setIsScanning(false);
              }
            }
            if (decodeError && !(decodeError instanceof NotFoundException)) {
              // NotFoundException fires every frame the scanner doesn't find
              // a code — expected during continuous scanning. Anything else
              // is a real failure but it's recoverable; just keep scanning.
            }
          },
        );
        // Now safe to assign — controls definitely exists. The local
        // reference inside the callback is also bound here so the next
        // decode can use it without waiting for the React ref to settle.
        localControls = controls;

        // Same race-guard as above: if we were torn down during decode setup,
        // immediately stop the just-returned controls instead of stashing them.
        if (streamRef.current === null) {
          try {
            controls.stop();
          } catch {
            // ignore
          }
          return;
        }

        controlsRef.current = controls;
        setIsScanning(true);
      } catch (err: unknown) {
        // Always release whatever we managed to acquire before erroring out.
        releaseResources();
        setError(classifyScannerError(err));
        setIsScanning(false);
      }
    },
    [releaseResources],
  );

  // ── Camera controls ─────────────────────────────────────────────────
  //
  // All three methods are safe to call even when nothing is supported —
  // they short-circuit on missing capabilities/tracks rather than throw.
  // The UI feature-gates buttons on `capabilities.*` so users never see
  // a control they can't use, but the no-op guards prevent crashes if
  // capabilities flip mid-session (e.g. external camera unplugged).

  const toggleTorch = useCallback(async () => {
    const track = activeTrackRef.current;
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as ExtendedMediaTrackConstraintSet],
      });
      setTorchOn(next);
    } catch {
      // Some Android builds throw if torch was momentarily reclaimed by
      // the OS (e.g. screen off). Leave state unchanged so the UI
      // accurately reflects the hardware.
    }
  }, [torchOn]);

  const setZoom = useCallback(
    async (value: number) => {
      const track = activeTrackRef.current;
      if (!track) return;
      try {
        await track.applyConstraints({
          advanced: [{ zoom: value } as ExtendedMediaTrackConstraintSet],
        });
        setZoomState(value);
      } catch {
        // Outside supported range or transient failure — ignore.
      }
    },
    [],
  );

  const switchCamera = useCallback(async () => {
    const element = lastVideoElementRef.current;
    if (!element) return;
    // Flip the ref synchronously so the next startScanning reads the
    // new value. State mirror follows for UI re-render.
    const next: FacingMode =
      facingModeRef.current === "environment" ? "user" : "environment";
    facingModeRef.current = next;
    setFacingMode(next);
    // Full restart: tear down + re-acquire with new facing. startScanning
    // handles its own teardown defensively, but we keep this explicit so
    // the camera indicator visibly transitions off→on rather than
    // appearing to glitch.
    releaseResources();
    await startScanningRef.current?.(element);
  }, [releaseResources]);

  // Late-binding ref so switchCamera can reach startScanning without
  // creating a useCallback dependency cycle. Updated below.
  const startScanningRef = useRef<typeof startScanning | null>(null);
  startScanningRef.current = startScanning;

  // Unmount cleanup. Runs on every component-tree teardown — including
  // Next.js route changes, conditional unmounts, and React StrictMode's
  // dev double-mount cycle. Idempotent thanks to releaseResources's guards.
  useEffect(() => {
    return () => {
      releaseResources();
    };
  }, [releaseResources]);

  return {
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
    facingMode,
    switchCamera,
  };
}
