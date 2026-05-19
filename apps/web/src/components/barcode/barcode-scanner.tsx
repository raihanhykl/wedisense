"use client";

import { useCallback, useEffect, useRef } from "react";
import { useBarcodeScan } from "@/hooks/use-barcode-scan";
import { cn } from "@/lib/utils";

interface BarcodeScannerProps {
  onScan: (value: string) => void;
  onClose: () => void;
}

export default function BarcodeScanner({
  onScan,
  onClose,
}: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { startScanning, stopScanning, isScanning, lastResult, error } =
    useBarcodeScan();

  const handleStart = useCallback(async () => {
    if (videoRef.current) {
      await startScanning(videoRef.current);
    }
  }, [startScanning]);

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

  // Relay result to parent
  useEffect(() => {
    if (lastResult) {
      onScan(lastResult);
    }
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
      {isScanning && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          {/* Dimmed edges */}
          <div className="absolute inset-0 bg-black/40" />
          {/* Clear center box */}
          <div className="relative h-64 w-64 sm:h-72 sm:w-72">
            <div className="absolute inset-0 bg-transparent" />
            {/* Corner markers */}
            <span className="absolute left-0 top-0 h-8 w-8 border-l-4 border-t-4 border-white" />
            <span className="absolute right-0 top-0 h-8 w-8 border-r-4 border-t-4 border-white" />
            <span className="absolute bottom-0 left-0 h-8 w-8 border-b-4 border-l-4 border-white" />
            <span className="absolute bottom-0 right-0 h-8 w-8 border-b-4 border-r-4 border-white" />
            {/* Scanning line animation */}
            <div className="absolute left-2 right-2 top-1/2 h-0.5 -translate-y-1/2 animate-pulse bg-green-400" />
          </div>
          {/* Instruction text */}
          <p className="absolute bottom-32 text-center text-sm text-white">
            Align barcode within the frame
          </p>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 p-6">
          <div className="rounded-lg bg-destructive/10 p-6 text-center">
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
            <p className="mb-4 text-sm font-medium text-white">{error}</p>
            <button
              onClick={handleClose}
              className={cn(
                "rounded-md bg-white px-4 py-2 text-sm font-medium text-black",
                "hover:bg-gray-200 transition-colors",
              )}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Close button */}
      <button
        onClick={handleClose}
        className={cn(
          "absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center",
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
  );
}
