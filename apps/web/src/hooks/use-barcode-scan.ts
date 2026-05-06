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

export function useBarcodeScan(): UseBarcodeScanReturn {
  const [isScanning, setIsScanning] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const controlsRef = useRef<IScannerControls | null>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);

  const stopScanning = useCallback(() => {
    if (controlsRef.current) {
      controlsRef.current.stop();
      controlsRef.current = null;
    }
    setIsScanning(false);
  }, []);

  const startScanning = useCallback(
    async (videoElement: HTMLVideoElement) => {
      setError(null);
      setLastResult(null);

      try {
        if (!readerRef.current) {
          // Configure hints for better 1D barcode (Code128) detection
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

        const controls = await readerRef.current.decodeFromConstraints(
          {
            video: {
              facingMode: "environment",
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
          },
          videoElement,
          (result, decodeError) => {
            if (result) {
              const text = result.getText();
              setLastResult(text);
              stopScanning();
            }
            if (decodeError && !(decodeError instanceof NotFoundException)) {
              // NotFoundException is expected during continuous scanning
              // Only set error for actual failures
            }
          },
        );

        controlsRef.current = controls;
        setIsScanning(true);
      } catch (err: unknown) {
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
    [stopScanning],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (controlsRef.current) {
        controlsRef.current.stop();
        controlsRef.current = null;
      }
    };
  }, []);

  return { startScanning, stopScanning, isScanning, lastResult, error };
}
