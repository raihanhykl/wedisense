"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import BarcodeScanner from "@/components/barcode/barcode-scanner";
import { apiGet, apiPost } from "@/lib/api";
import { cn } from "@/lib/utils";

// ── EAN-13 validation ─────────────────────────────────────────────────
function isValidEan13(value: string): boolean {
  if (!/^\d{13}$/.test(value)) return false;
  const digits = value.split("").map(Number);
  const check = digits
    .slice(0, 12)
    .reduce((sum, d, i) => sum + d * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (check % 10)) % 10 === digits[12];
}

// ── Types ─────────────────────────────────────────────────────────────
type ScanState =
  | { kind: "idle" }
  | { kind: "scanning" }
  | { kind: "loading"; value: string }
  | { kind: "asset-found"; value: string; assetId: string }
  | {
      kind: "product-found";
      value: string;
      product: { name: string; brand?: string; category?: string };
    }
  | { kind: "product-not-found"; value: string }
  | { kind: "unrecognized"; value: string }
  | { kind: "error"; value: string; message: string };

interface AssetLookupResult {
  id: string;
}

interface ProductLookupResult {
  name: string;
  brand?: string;
  category?: string;
}

export default function ScanPage() {
  const router = useRouter();
  const [state, setState] = useState<ScanState>({ kind: "idle" });

  const handleScan = useCallback(
    async (value: string) => {
      setState({ kind: "loading", value });

      try {
        // 1. Check if it matches an internal asset barcode
        try {
          const asset = await apiGet<AssetLookupResult>(
            `/api/assets/barcode/${encodeURIComponent(value)}`,
          );
          if (asset?.id) {
            router.push(`/admin/assets/${asset.id}`);
            return;
          }
        } catch {
          // Not an internal asset — continue
        }

        // 2. Check if EAN-13
        if (isValidEan13(value)) {
          try {
            const product = await apiPost<ProductLookupResult>(
              "/api/products/lookup",
              { ean: value },
            );
            if (product?.name) {
              setState({ kind: "product-found", value, product });
            } else {
              setState({ kind: "product-not-found", value });
            }
          } catch {
            setState({ kind: "product-not-found", value });
          }
          return;
        }

        // 3. Unrecognized barcode format
        setState({ kind: "unrecognized", value });
      } catch {
        setState({
          kind: "error",
          value,
          message: "An error occurred while processing the barcode.",
        });
      }
    },
    [router],
  );

  const openScanner = () => setState({ kind: "scanning" });
  const dismiss = () => setState({ kind: "idle" });

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center bg-background p-4"
      data-tour="barcode-scanner"
    >
      {/* Scanner overlay */}
      {state.kind === "scanning" && (
        <BarcodeScanner
          onScan={handleScan}
          onClose={() => setState({ kind: "idle" })}
        />
      )}

      {/* Idle: Tap to Scan */}
      {state.kind === "idle" && (
        <div className="flex flex-col items-center gap-6 text-center">
          <h1 className="text-2xl font-bold tracking-tight">Barcode Scanner</h1>
          <p className="max-w-sm text-sm text-muted-foreground">
            Scan an asset barcode or product EAN to quickly find or register
            items.
          </p>
          <button
            onClick={openScanner}
            className={cn(
              "flex h-32 w-32 flex-col items-center justify-center gap-2 rounded-2xl",
              "bg-primary text-primary-foreground shadow-lg",
              "hover:bg-primary/90 active:scale-95 transition-all",
            )}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-10 w-10"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2"
              />
              <line x1="7" y1="12" x2="17" y2="12" />
            </svg>
            <span className="text-sm font-medium">Tap to Scan</span>
          </button>
        </div>
      )}

      {/* Loading */}
      {state.kind === "loading" && (
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">
            Looking up <span className="font-mono font-medium">{state.value}</span>...
          </p>
        </div>
      )}

      {/* Product Found */}
      {state.kind === "product-found" && (
        <DialogCard
          title="Product Found"
          value={state.value}
          onDismiss={dismiss}
        >
          <div className="space-y-1 text-left text-sm">
            <p>
              <span className="font-medium">Name:</span> {state.product.name}
            </p>
            {state.product.brand && (
              <p>
                <span className="font-medium">Brand:</span>{" "}
                {state.product.brand}
              </p>
            )}
            {state.product.category && (
              <p>
                <span className="font-medium">Category:</span>{" "}
                {state.product.category}
              </p>
            )}
          </div>
          <div className="mt-4 flex gap-2">
            <button
              onClick={() =>
                router.push(
                  `/admin/assets/new?ean=${encodeURIComponent(state.value)}`,
                )
              }
              className="flex-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Create Asset
            </button>
            <button
              onClick={dismiss}
              className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent"
            >
              Cancel
            </button>
          </div>
        </DialogCard>
      )}

      {/* Product Not Found */}
      {state.kind === "product-not-found" && (
        <DialogCard
          title="Product Not Found"
          value={state.value}
          onDismiss={dismiss}
        >
          <p className="text-sm text-muted-foreground">
            No product information was found for this EAN code.
          </p>
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => router.push("/admin/assets/new")}
              className="flex-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Create Asset Manually
            </button>
            <button
              onClick={dismiss}
              className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent"
            >
              Cancel
            </button>
          </div>
        </DialogCard>
      )}

      {/* Unrecognized */}
      {state.kind === "unrecognized" && (
        <DialogCard
          title="Barcode Not Recognized"
          value={state.value}
          onDismiss={dismiss}
        >
          <p className="text-sm text-muted-foreground">
            This barcode does not match any known asset or product format.
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button
              onClick={() => router.push("/admin/assets/new")}
              className="flex-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Create new asset
            </button>
            <button
              onClick={() =>
                router.push(
                  `/admin/assets?search=${encodeURIComponent(state.value)}`,
                )
              }
              className="flex-1 rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent"
            >
              Search manually
            </button>
            <button
              onClick={dismiss}
              className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent"
            >
              Cancel
            </button>
          </div>
        </DialogCard>
      )}

      {/* Error */}
      {state.kind === "error" && (
        <DialogCard
          title="Error"
          value={state.value}
          onDismiss={dismiss}
        >
          <p className="text-sm text-destructive">{state.message}</p>
          <div className="mt-4">
            <button
              onClick={dismiss}
              className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent"
            >
              Dismiss
            </button>
          </div>
        </DialogCard>
      )}
    </div>
  );
}

// ── Reusable dialog card ──────────────────────────────────────────────
function DialogCard({
  title,
  value,
  onDismiss,
  children,
}: {
  title: string;
  value: string;
  onDismiss: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="w-full max-w-sm rounded-lg border bg-card p-6 shadow-lg">
      <div className="mb-4 flex items-start justify-between">
        <h2 className="text-lg font-semibold">{title}</h2>
        <button
          onClick={onDismiss}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Dismiss"
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
      <p className="mb-3 rounded bg-muted px-2 py-1 font-mono text-xs">
        {value}
      </p>
      {children}
    </div>
  );
}
