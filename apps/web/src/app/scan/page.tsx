"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Box,
  Keyboard,
  MapPin,
  Package,
  ScanLine,
  Settings,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import BarcodeScanner from "@/components/barcode/barcode-scanner";
import BatchActionSheet from "@/components/barcode/batch-action-sheet";
import ManualEntryDialog from "@/components/barcode/manual-entry-dialog";
import ScanSettingsDialog from "@/components/barcode/scan-settings-dialog";
import ProtectedRoute from "@/components/shared/protected-route";
import { apiGet, apiPost } from "@/lib/api";
import {
  clearRecentScans,
  formatRelativeTime,
  pushRecentScan,
  useRecentScans,
  type RecentScan,
} from "@/lib/scan-history";
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

// ── Internal URL detection ────────────────────────────────────────────
//
// Internal QR codes encode the resource's detail-page URL so a camera scan
// can route directly without a network hop. Two patterns supported:
//   - Locations: `{APP_BASE_URL}/admin/locations/<uuid>`
//   - Assets:    `{APP_BASE_URL}/admin/assets/<uuid>` (current) OR
//                `{APP_BASE_URL}/assets/<uuid>`       (legacy — pre-Tier 1
//                fix; existing printed labels keep working)
//
// We accept any base (a QR captured at print time might not match the
// current host for staging→prod migrations) and just extract the UUID from
// the path. Strict UUID v4-ish regex prevents matches on malformed values.
const UUID_RE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

const LOCATION_URL_PATTERN = new RegExp(
  `/admin/locations/(${UUID_RE})(?:/|$|\\?)`,
  'i',
);
// Asset path accepts both `/admin/assets/` (current) and `/assets/`
// (legacy — older QR labels predating the URL fix). Order in the alternation
// matters: the more specific `/admin/assets/` is matched first so the
// match group always captures the same UUID slot.
const ASSET_URL_PATTERN = new RegExp(
  `/(?:admin/)?assets/(${UUID_RE})(?:/|$|\\?)`,
  'i',
);

function extractLocationIdFromUrl(value: string): string | null {
  const match = LOCATION_URL_PATTERN.exec(value);
  return match?.[1] ?? null;
}

function extractAssetIdFromUrl(value: string): string | null {
  const match = ASSET_URL_PATTERN.exec(value);
  return match?.[1] ?? null;
}

// ── Types ─────────────────────────────────────────────────────────────
// `asset-found` deliberately omitted — successful asset lookups call
// router.push() directly inside handleScan and never settle into a UI
// state. Including it created dead branches and made the union misleading.
type ScanState =
  | { kind: "idle" }
  | { kind: "scanning" }
  | { kind: "loading"; value: string }
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
  product: { id: string; name: string; brand: string | null } | null;
  lookup: { name: string; brand: string | null; model: string | null } | null;
  source: string;
}

// ── Batch cart types ──────────────────────────────────────────────────
//
// Each batch entry is an already-resolved asset (we only allow asset
// barcodes/QRs into the cart — location URLs and EANs don't fit the
// bulk-action endpoints). The location field is shown in the action sheet
// so the user knows where assets currently sit before bulk-moving them.
interface BatchAssetEntry {
  id: string;
  name: string;
  assetNumber: string;
  location: { id: string; name: string; code: string } | null;
  /** Timestamp of when this entry hit the cart — used to render newest-first. */
  ts: number;
}

export default function ScanPage() {
  const router = useRouter();
  const [state, setState] = useState<ScanState>({ kind: "idle" });
  // Manual entry overlay — opens via the "Enter manually" button on the
  // idle screen or via the scanner's recovery CTA when a camera error
  // fires. Submits through the same handleScan pipeline as the camera.
  const [manualOpen, setManualOpen] = useState(false);
  // Settings panel — sound/vibrate toggles + future per-user prefs.
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Scan mode — chosen on the idle screen, applied when the camera opens.
  // 'single' is the legacy flow (one decode → navigate). 'batch' keeps
  // the camera open per decode, resolves each to an asset, and surfaces
  // a bulk-action sheet on close.
  const [scanMode, setScanMode] = useState<"single" | "batch">("single");
  const [batchCart, setBatchCart] = useState<BatchAssetEntry[]>([]);
  const [batchSheetOpen, setBatchSheetOpen] = useState(false);

  const handleScan = useCallback(
    async (value: string) => {
      setState({ kind: "loading", value });

      try {
        // 0. Internal location QR — match before any API call. The scanner
        //    returns the embedded URL verbatim; if it's one of our location
        //    detail URLs we can route immediately without a network hop.
        const locationId = extractLocationIdFromUrl(value);
        if (locationId) {
          pushRecentScan({
            value,
            outcome: "Location opened",
            kind: "location",
          });
          router.push(`/admin/locations/${locationId}`);
          return;
        }

        // 0.5. Internal asset QR — same idea as the location branch above.
        //    Backward-compatible with the legacy `/assets/<uuid>` URL shape
        //    pre-Tier 1 fix; both forms route to /admin/assets/<id>.
        const assetIdFromUrl = extractAssetIdFromUrl(value);
        if (assetIdFromUrl) {
          pushRecentScan({
            value,
            outcome: "Asset opened (QR)",
            kind: "asset",
          });
          router.push(`/admin/assets/${assetIdFromUrl}`);
          return;
        }

        // 1. Check if it matches an internal asset barcode
        try {
          const asset = await apiGet<AssetLookupResult>(
            `/api/assets/barcode/${encodeURIComponent(value)}`,
          );
          if (asset?.id) {
            pushRecentScan({
              value,
              outcome: `Asset: ${value}`,
              kind: "asset",
            });
            router.push(`/admin/assets/${asset.id}`);
            return;
          }
        } catch {
          // Not an internal asset — continue
        }

        // 2. Check if EAN-13
        if (isValidEan13(value)) {
          try {
            const result = await apiPost<ProductLookupResult>(
              "/api/products/lookup",
              { ean: value },
            );
            const productInfo = result?.product
              ? { name: result.product.name, brand: result.product.brand ?? undefined }
              : result?.lookup
                ? { name: result.lookup.name, brand: result.lookup.brand ?? undefined }
                : null;
            if (productInfo?.name) {
              pushRecentScan({
                value,
                outcome: `Product: ${productInfo.name}`,
                kind: "product",
              });
              setState({ kind: "product-found", value, product: productInfo });
            } else {
              pushRecentScan({
                value,
                outcome: "EAN not found",
                kind: "unrecognized",
              });
              setState({ kind: "product-not-found", value });
            }
          } catch {
            pushRecentScan({
              value,
              outcome: "EAN lookup failed",
              kind: "unrecognized",
            });
            setState({ kind: "product-not-found", value });
          }
          return;
        }

        // 3. Unrecognized barcode format
        pushRecentScan({
          value,
          outcome: "Unrecognized",
          kind: "unrecognized",
        });
        setState({ kind: "unrecognized", value });
      } catch {
        pushRecentScan({
          value,
          outcome: "Error",
          kind: "unrecognized",
        });
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

  // Batch-mode decode handler. Resolves each scanned value to an asset
  // (the only entity the bulk-action endpoints accept) and pushes it
  // into the cart. Rejects location URLs and EANs with a toast so the
  // user knows the scan was received but ignored.
  const handleBatchScan = useCallback(async (value: string) => {
    // Asset URL (QR) → resolve via GET /:id then push.
    const assetIdFromUrl = extractAssetIdFromUrl(value);
    if (assetIdFromUrl) {
      try {
        const asset = await apiGet<BatchAssetEntry>(
          `/api/assets/${assetIdFromUrl}`,
        );
        setBatchCart((prev) => {
          if (prev.some((p) => p.id === asset.id)) {
            toast.info(`Already in batch: ${asset.name}`);
            return prev;
          }
          toast.success(`Added: ${asset.name}`);
          return [{ ...asset, ts: Date.now() }, ...prev];
        });
      } catch {
        toast.error("Failed to load scanned asset");
      }
      return;
    }
    // Location URL → reject; can't bulk-act on locations.
    if (extractLocationIdFromUrl(value)) {
      toast.error("Locations can't be added to a batch — switch off batch mode to open the location.");
      return;
    }
    // Asset barcode lookup.
    try {
      const asset = await apiGet<BatchAssetEntry>(
        `/api/assets/barcode/${encodeURIComponent(value)}`,
      );
      setBatchCart((prev) => {
        if (prev.some((p) => p.id === asset.id)) {
          toast.info(`Already in batch: ${asset.name}`);
          return prev;
        }
        toast.success(`Added: ${asset.name}`);
        return [{ ...asset, ts: Date.now() }, ...prev];
      });
    } catch {
      // Final rejection — could be EAN or unrecognized. Either way the
      // bulk endpoints can't act on it, so we don't fall through.
      toast.error("Not an asset barcode. Only assets can be batched.");
    }
  }, []);

  const handleBatchClose = useCallback(() => {
    // Closing the scanner from batch mode = commit the batch. If items
    // were collected, surface the action sheet; otherwise just go back
    // to idle (no-op batch is a normal user choice).
    setState({ kind: "idle" });
    if (batchCart.length > 0) {
      setBatchSheetOpen(true);
    }
  }, [batchCart.length]);

  // Back navigation. Try router.back() so users land where they came
  // from (asset detail, dashboard, …). If history is empty (direct URL
  // entry, bookmark, fresh tab), fall back to the dashboard so users
  // never get stuck on /scan with no escape.
  const handleBack = useCallback(() => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/dashboard");
    }
  }, [router]);

  return (
    <ProtectedRoute>
      <div
        className="flex min-h-screen flex-col bg-background"
        data-tour="barcode-scanner"
      >
        {/* Top chrome — back button + title + settings icon. Sticky so the
            user always has a navigation handle while scrolling recent scans
            on a long history. The scanner overlay covers this via its own
            fixed positioning when active, so the header doesn't peek
            through during a scan. */}
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-card px-3 sm:px-4">
          <button
            type="button"
            onClick={handleBack}
            aria-label="Back"
            className="-ml-1 inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-base font-semibold">Scan</h1>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label="Scan settings"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Settings className="h-4 w-4" />
          </button>
        </header>

        {/* Main scrollable area — scan idle UI, result dialogs, loading.
            Camera overlay is `fixed inset-0` so it sits above this. */}
        <main className="flex flex-1 flex-col items-center justify-center p-4">
      {/* Scanner overlay — single OR batch mode based on the toggle from
          the idle screen. The scanner component is the same; behaviour
          differs in onScan target + mode flag. */}
      {state.kind === "scanning" && (
        <BarcodeScanner
          mode={scanMode === "batch" ? "continuous" : "single"}
          batchCount={batchCart.length}
          onScan={scanMode === "batch" ? handleBatchScan : handleScan}
          onClose={scanMode === "batch" ? handleBatchClose : () => setState({ kind: "idle" })}
          onManualEntry={() => {
            setState({ kind: "idle" });
            setManualOpen(true);
          }}
        />
      )}

      {/* Idle: Tap to Scan */}
      {state.kind === "idle" && (
        <IdleView
          scanMode={scanMode}
          onSetScanMode={setScanMode}
          batchCount={batchCart.length}
          onResumeBatch={() => {
            if (batchCart.length > 0) setBatchSheetOpen(true);
          }}
          onOpenScanner={openScanner}
          onOpenManual={() => setManualOpen(true)}
          onResolveScan={handleScan}
        />
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

      {/* Manual entry — same handleScan pipeline as the camera flow.
          Closing fires nothing; the user-typed value goes through the
          standard 3-tier resolution chain. */}
      <ManualEntryDialog
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        onSubmit={(value) => {
          setManualOpen(false);
          void handleScan(value);
        }}
      />

      {/* User preferences (sound + vibrate). Tier 5 — surface here from
          the idle screen's gear button. */}
      <ScanSettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />

      {/* Batch action sheet — appears after the user closes a batch
          scan with at least one collected asset. Owns its own picker
          UI + commits via the existing bulk-action endpoints. */}
      <BatchActionSheet
        open={batchSheetOpen}
        assets={batchCart}
        onRemoveAsset={(id) =>
          setBatchCart((prev) => prev.filter((a) => a.id !== id))
        }
        onClose={() => setBatchSheetOpen(false)}
        onCommitted={() => {
          setBatchCart([]);
          setBatchSheetOpen(false);
        }}
      />
        </main>
      </div>
    </ProtectedRoute>
  );
}

// ── Idle view ─────────────────────────────────────────────────────────
//
// Split out so the wedge-detector input + history list don't bloat the
// main ScanPage render. Owns its own hidden input ref so the input can
// always-on-focus (refocus on blur) without thrashing parent state.

interface IdleViewProps {
  scanMode: "single" | "batch";
  onSetScanMode: (mode: "single" | "batch") => void;
  /** Items already in the batch cart — when >0, we surface a "Resume batch"
   *  action so the user can re-open the action sheet without scanning again. */
  batchCount: number;
  onResumeBatch: () => void;
  onOpenScanner: () => void;
  onOpenManual: () => void;
  /** Single resolver used for both hardware-wedge input AND clicking a
   *  recent-scans row to re-resolve the value. Always pipes through the
   *  same 3-tier handleScan pipeline so behaviour matches the camera
   *  path exactly. */
  onResolveScan: (value: string) => void;
}

// USB barcode scanners emulate a keyboard: they fire each character
// keydown event in rapid succession (<50ms between keys) and conclude
// with Enter. Humans typing manually rarely hit <100ms intervals. We
// treat any input that arrives <THRESHOLD apart as a wedge and commit
// on Enter when the buffer has at least MIN_LENGTH chars.
const WEDGE_CHAR_THRESHOLD_MS = 80;
const WEDGE_MIN_LENGTH = 3;

function IdleView({
  scanMode,
  onSetScanMode,
  batchCount,
  onResumeBatch,
  onOpenScanner,
  onOpenManual,
  onResolveScan,
}: IdleViewProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const recentScans = useRecentScans();

  // Refocus the hidden input whenever it loses focus so a USB scanner can
  // always deliver into it. Only suspends when a modal opens (the modal's
  // own input then handles the scanner — wedge input is delivered into
  // whichever element has focus).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    // Initial focus on mount.
    el.focus();
    const onBlur = () => {
      // Defer to next tick so user can interact with buttons; refocus
      // afterwards. Skip if the document doesn't own focus (e.g. user
      // switched tabs) — focusing then would steal focus on return.
      setTimeout(() => {
        if (document.hasFocus() && inputRef.current === el) {
          el.focus();
        }
      }, 0);
    };
    el.addEventListener("blur", onBlur);
    return () => el.removeEventListener("blur", onBlur);
  }, []);

  // Wedge detector state lives in refs so the timing math doesn't trigger
  // React re-renders on every keystroke.
  const bufferRef = useRef("");
  const lastKeyTsRef = useRef(0);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const now = Date.now();
    const gap = now - lastKeyTsRef.current;
    lastKeyTsRef.current = now;

    if (e.key === "Enter") {
      const value = bufferRef.current.trim();
      bufferRef.current = "";
      if (value.length >= WEDGE_MIN_LENGTH) {
        e.preventDefault();
        onResolveScan(value);
      }
      return;
    }

    // Printable single-character keys only — ignore Shift, Tab, arrows,
    // etc. so a stray modifier doesn't poison the buffer.
    if (e.key.length !== 1) return;

    // If gap is large the previous "buffer" was a human typing or stale
    // data — start fresh. Wedge scanners almost always fire <50ms apart.
    if (gap > WEDGE_CHAR_THRESHOLD_MS) {
      bufferRef.current = e.key;
    } else {
      bufferRef.current += e.key;
    }
  };

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-6 text-center">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Barcode Scanner</h1>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
          Scan an asset barcode or product EAN to quickly find or register
          items.
        </p>
      </div>

      {/* Mode segment — Single (default, one scan navigates) vs Batch
          (collect multiple, surface bulk-action sheet on close). Choice
          persists until user flips it; doesn't reset between sessions. */}
      <div
        role="tablist"
        aria-label="Scan mode"
        className="inline-flex rounded-full border bg-card p-0.5 text-xs font-medium"
      >
        <ModePill
          active={scanMode === "single"}
          label="Single"
          onClick={() => onSetScanMode("single")}
        />
        <ModePill
          active={scanMode === "batch"}
          label="Batch"
          badge={batchCount > 0 ? batchCount : undefined}
          onClick={() => onSetScanMode("batch")}
        />
      </div>

      <button
        onClick={onOpenScanner}
        className={cn(
          "flex h-32 w-32 flex-col items-center justify-center gap-2 rounded-2xl",
          "bg-primary text-primary-foreground shadow-lg",
          "hover:bg-primary/90 active:scale-95 transition-all",
        )}
      >
        <ScanLine className="h-10 w-10" />
        <span className="text-sm font-medium">
          {scanMode === "batch" ? "Start Batch" : "Tap to Scan"}
        </span>
      </button>

      {/* Resume-batch CTA — visible only when the cart has items but the
          action sheet was dismissed without committing. Lets the user
          jump back into the bulk-action UI without opening the camera. */}
      {batchCount > 0 && (
        <button
          type="button"
          onClick={onResumeBatch}
          className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20"
        >
          Resume batch · {batchCount} item{batchCount === 1 ? "" : "s"}
        </button>
      )}

      {/* Secondary action — manual text entry. Settings live in the page
          header (gear icon) so this row stays focused on the input modes. */}
      <button
        type="button"
        onClick={onOpenManual}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        <Keyboard className="h-3.5 w-3.5" />
        Enter manually
      </button>

      {/* Wedge detector — visually hidden but real focusable input. USB
          barcode scanners type their decoded value into whatever has
          focus, so we keep this input focused while the idle screen is
          open. The input value itself is throw-away (we read via
          keydown buffer); the input is just a focus target. */}
      <input
        ref={inputRef}
        type="text"
        aria-hidden
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="absolute h-0 w-0 opacity-0"
        // Prevents the value from accumulating — keydown handler owns
        // the buffer logic; native value is irrelevant.
        onChange={() => {}}
      />

      {recentScans.length > 0 ? (
        <RecentScansCard scans={recentScans} onResolve={onResolveScan} />
      ) : (
        // Empty-state hint about hardware wedge — only shown when the user
        // hasn't successfully scanned yet, so it stops cluttering the
        // screen the moment they see scan results.
        <p className="text-xs text-muted-foreground/60">
          USB scanner? Just scan — input is auto-captured.
        </p>
      )}
    </div>
  );
}

// ── Mode pill ─────────────────────────────────────────────────────────

function ModePill({
  active,
  label,
  badge,
  onClick,
}: {
  active: boolean;
  label: string;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
      {badge !== undefined && (
        <span
          className={cn(
            "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold",
            active ? "bg-primary-foreground/20" : "bg-primary/20 text-primary",
          )}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

// ── Recent scans card ─────────────────────────────────────────────────

function RecentScansCard({
  scans,
  onResolve,
}: {
  scans: RecentScan[];
  onResolve: (value: string) => void;
}) {
  return (
    <div className="w-full rounded-lg border bg-card text-left">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Recent scans
        </h2>
        <button
          type="button"
          onClick={() => clearRecentScans()}
          aria-label="Clear history"
          className="inline-flex items-center gap-1 rounded p-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Trash2 className="h-3 w-3" />
          Clear
        </button>
      </div>
      <ul className="divide-y">
        {scans.slice(0, 8).map((s, i) => (
          <li key={`${s.value}-${s.ts}-${i}`}>
            <button
              type="button"
              onClick={() => onResolve(s.value)}
              className="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-accent"
              title={`Re-resolve: ${s.value}`}
            >
              <KindIcon kind={s.kind} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{s.outcome}</p>
                <p className="truncate font-mono text-[11px] text-muted-foreground">
                  {s.value}
                </p>
              </div>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {formatRelativeTime(s.ts)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function KindIcon({ kind }: { kind: RecentScan["kind"] }) {
  const cls = "h-3.5 w-3.5 shrink-0";
  switch (kind) {
    case "asset":
      return <Box className={cn(cls, "text-green-600")} />;
    case "location":
      return <MapPin className={cn(cls, "text-blue-600")} />;
    case "product":
      return <Package className={cn(cls, "text-indigo-600")} />;
    case "unrecognized":
      return <XCircle className={cn(cls, "text-muted-foreground")} />;
  }
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
