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

interface UseBarcodeScanReturn {
  startScanning: (videoElement: HTMLVideoElement) => Promise<void>;
  stopScanning: () => void;
  isScanning: boolean;
  lastResult: string | null;
  error: string | null;
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
export function useBarcodeScan(): UseBarcodeScanReturn {
  const [isScanning, setIsScanning] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  // Idempotent full teardown. Called from three places (see hook doc).
  // Always:
  //  1. ask zxing to stop its scan loop (if it ever started),
  //  2. stop every track on our captured stream,
  //  3. detach the stream from the <video> element.
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
  }, []);

  const stopScanning = useCallback(() => {
    releaseResources();
    setIsScanning(false);
  }, [releaseResources]);

  const startScanning = useCallback(
    async (videoElement: HTMLVideoElement) => {
      setError(null);
      setLastResult(null);

      // Defensive: if a previous start is still wired up, tear it down first.
      releaseResources();

      // Track the element early so the cleanup path can null its srcObject
      // even if zxing throws before binding.
      videoRef.current = videoElement;

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

        // Acquire the stream ourselves so we own its lifecycle.
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "environment",
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        });
        streamRef.current = stream;

        // If the component unmounted (or stopScanning was called) WHILE we
        // were waiting for getUserMedia, releaseResources has already nulled
        // streamRef. Detect that and tear down immediately — don't hand the
        // freshly-acquired stream to zxing.
        if (streamRef.current !== stream) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }

        const controls = await readerRef.current.decodeFromStream(
          stream,
          videoElement,
          (result, decodeError) => {
            if (result) {
              setLastResult(result.getText());
              // Caller will typically unmount us in response, but tearing
              // down preemptively means the camera indicator turns off
              // *now* instead of waiting for the unmount cycle.
              releaseResources();
              setIsScanning(false);
            }
            if (decodeError && !(decodeError instanceof NotFoundException)) {
              // NotFoundException fires every frame the scanner doesn't find
              // a code — expected during continuous scanning. Anything else
              // is a real failure but it's recoverable; just keep scanning.
            }
          },
        );

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
        const message =
          err instanceof DOMException && err.name === "NotAllowedError"
            ? "Camera permission denied. Please allow camera access in your browser settings."
            : err instanceof DOMException && err.name === "NotFoundError"
              ? "No camera found on this device."
              : err instanceof Error
                ? err.message
                : "Failed to start camera.";
        setError(message);
        setIsScanning(false);
      }
    },
    [releaseResources],
  );

  // Unmount cleanup. Runs on every component-tree teardown — including
  // Next.js route changes, conditional unmounts, and React StrictMode's
  // dev double-mount cycle. Idempotent thanks to releaseResources's guards.
  useEffect(() => {
    return () => {
      releaseResources();
    };
  }, [releaseResources]);

  return { startScanning, stopScanning, isScanning, lastResult, error };
}
