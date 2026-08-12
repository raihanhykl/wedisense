"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  Ban,
  Download,
  FileCheck2,
  Loader2,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import ProtectedRoute from "@/components/shared/protected-route";
import Breadcrumb from "@/components/shared/breadcrumb";
import FileDropzone from "@/components/shared/file-dropzone";
import { apiDelete, apiGet, apiGetBlob, apiPost, apiPostForm } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/error";
import { usePermission } from "@/hooks/use-permission";
import {
  HANDOVER_STATUS_CLASSES,
  HANDOVER_STATUS_HINTS,
  HANDOVER_STATUS_LABELS,
  HANDOVER_TYPE_LABELS,
  canUploadScan,
  formatHandoverDate,
  isEditable,
} from "@/lib/handover";
import type { HandoverFormDetail, HandoverParty } from "@/types/admin";

const SCAN_MAX_MB = 10;

function HandoverFormDetailContent() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const canUpdate = usePermission("handover-forms:update");

  const [form, setForm] = useState<HandoverFormDetail | null>(null);
  const [loading, setLoading] = useState(true);

  // The PDF and the signed scan both sit behind authorize(), so they're
  // fetched as blobs and shown from object URLs rather than a plain <iframe
  // src>, which would send no Authorization header and 401.
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const objectUrls = useRef<string[]>([]);

  const [scanFile, setScanFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const trackObjectUrl = (url: string) => {
    objectUrls.current.push(url);
    return url;
  };

  // Object URLs pin their blob in memory until revoked; releasing them on
  // unmount keeps a long admin session from accumulating multi-MB PDFs.
  useEffect(() => {
    const urls = objectUrls.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const fetchForm = useCallback(async () => {
    setLoading(true);
    try {
      setForm(await apiGet<HandoverFormDetail>(`/api/handover-forms/${id}`));
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Failed to load the handover form"));
      router.replace("/admin/handover-forms");
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    void fetchForm();
  }, [fetchForm]);

  const loadPdf = useCallback(
    async (options: { silent?: boolean } = {}) => {
      setPdfLoading(true);
      try {
        const blob = await apiGetBlob(`/api/handover-forms/${id}/pdf`);
        setPdfUrl(trackObjectUrl(URL.createObjectURL(blob)));
        // The first render flips DRAFT → ISSUED server-side, so refresh the
        // record to keep the status badge and action buttons honest.
        await fetchForm();
      } catch (err) {
        if (!options.silent) {
          toast.error(getApiErrorMessage(err, "Failed to generate the PDF"));
        }
      } finally {
        setPdfLoading(false);
      }
    },
    [id, fetchForm],
  );

  const downloadPdf = async () => {
    if (!form) return;
    try {
      const blob = await apiGetBlob(`/api/handover-forms/${id}/pdf`);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `BAST-${form.formNumber.replace(/\//g, "-")}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
      await fetchForm();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Failed to download the PDF"));
    }
  };

  const openScan = async () => {
    try {
      const blob = await apiGetBlob(`/api/handover-forms/${id}/scan`);
      window.open(trackObjectUrl(URL.createObjectURL(blob)), "_blank");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Failed to open the signed scan"));
    }
  };

  const uploadScan = async () => {
    if (!scanFile) return;
    setUploading(true);
    try {
      const data = new FormData();
      data.append("file", scanFile);
      setForm(await apiPostForm<HandoverFormDetail>(`/api/handover-forms/${id}/scan`, data));
      setScanFile(null);
      toast.success("Signed scan uploaded — this form can now be cited by movements.");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Failed to upload the signed scan"));
    } finally {
      setUploading(false);
    }
  };

  const removeScan = async () => {
    if (!confirm("Remove the uploaded scan? The form returns to Issued.")) return;
    try {
      setForm(await apiDelete<HandoverFormDetail>(`/api/handover-forms/${id}/scan`));
      toast.success("Scan removed");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Failed to remove the scan"));
    }
  };

  const cancelForm = async () => {
    const reason = prompt("Why is this form being cancelled?");
    if (reason === null) return;
    if (!reason.trim()) {
      toast.error("A cancellation reason is required.");
      return;
    }
    try {
      setForm(
        await apiPost<HandoverFormDetail>(`/api/handover-forms/${id}/cancel`, {
          reason: reason.trim(),
        }),
      );
      toast.success("Handover form cancelled");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Failed to cancel the form"));
    }
  };

  const deleteDraft = async () => {
    if (!confirm("Delete this draft? It has no letter number in circulation yet.")) return;
    try {
      await apiDelete(`/api/handover-forms/${id}`);
      toast.success("Draft deleted");
      router.push("/admin/handover-forms");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Failed to delete the draft"));
    }
  };

  if (loading || !form) {
    return (
      <div className="flex items-center justify-center p-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const editable = isEditable(form.status);
  const scanAllowed = canUploadScan(form.status);

  return (
    <div className="p-6">
      <Breadcrumb
        items={[
          { label: "Handover Forms", href: "/admin/handover-forms" },
          { label: form.formNumber },
        ]}
      />

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-xl font-bold tracking-tight">{form.formNumber}</h1>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${HANDOVER_STATUS_CLASSES[form.status]}`}
            >
              {form.status === "SIGNED" && <FileCheck2 className="h-3 w-3" />}
              {HANDOVER_STATUS_LABELS[form.status]}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {HANDOVER_STATUS_HINTS[form.status]}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {canUpdate && editable && (
            <>
              <Link
                href={`/admin/handover-forms/${form.id}/edit`}
                className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted/50"
              >
                <Pencil className="h-4 w-4" />
                Edit
              </Link>
              <button
                type="button"
                onClick={deleteDraft}
                className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
              >
                <Trash2 className="h-4 w-4" />
                Delete draft
              </button>
            </>
          )}
          {canUpdate && form.status !== "CANCELLED" && form._count.movements === 0 && !editable && (
            <button
              type="button"
              onClick={cancelForm}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
            >
              <Ban className="h-4 w-4" />
              Cancel form
            </button>
          )}
          {form.status !== "CANCELLED" && (
            <button
              type="button"
              onClick={downloadPdf}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Download className="h-4 w-4" />
              Download PDF
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── Left: details ── */}
        <div className="space-y-4">
          <section className="rounded-lg border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">Transaction</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <Row label="Type">{HANDOVER_TYPE_LABELS[form.handoverType]}</Row>
              <Row label="Date">{formatHandoverDate(form.handoverDate)}</Row>
              {form.purpose && <Row label="Purpose">{form.purpose}</Row>}
              {form.notes && <Row label="Notes">{form.notes}</Row>}
              <Row label="Created by">{form.createdBy?.name ?? "—"}</Row>
            </dl>
          </section>

          <section className="rounded-lg border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">Parties</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <Row label="Handing over">
                <PartyLine party={form.fromUser} fallback="Company" />
                {form.fromLocation && (
                  <span className="block text-xs text-muted-foreground">
                    {form.fromLocation.name}
                  </span>
                )}
              </Row>
              <Row label="Receiving">
                <PartyLine party={form.toUser} fallback="Company" />
                {form.toLocation && (
                  <span className="block text-xs text-muted-foreground">
                    {form.toLocation.name}
                  </span>
                )}
              </Row>
              <Row label="IT officer">
                <PartyLine party={form.itOfficer} fallback="—" />
              </Row>
              <Row label="Acknowledged by">
                <PartyLine party={form.acknowledgedBy} fallback="Signed by hand on paper" />
              </Row>
            </dl>
          </section>

          <section className="rounded-lg border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">
              Assets ({form.items.length})
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="py-2 text-left font-medium">Asset</th>
                    <th className="py-2 text-left font-medium">Serial</th>
                    <th className="py-2 text-left font-medium">Condition</th>
                  </tr>
                </thead>
                <tbody>
                  {form.items.map((item) => (
                    <tr key={item.id} className="border-b last:border-b-0">
                      <td className="py-2">
                        <Link
                          href={`/admin/assets/${item.assetId}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {item.assetName}
                        </Link>
                        <div className="font-mono text-xs text-muted-foreground">
                          {item.assetNumber}
                        </div>
                        {item.itemNotes && (
                          <div className="text-xs text-muted-foreground">{item.itemNotes}</div>
                        )}
                      </td>
                      <td className="py-2 font-mono text-xs">{item.serialNumber ?? "—"}</td>
                      <td className="py-2">
                        <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
                          {item.condition}
                        </span>
                        {/* The snapshot is what was signed for; flagging drift
                            saves a trip to the asset page during disputes. */}
                        {item.asset && item.asset.condition !== item.condition && (
                          <span className="ml-1 text-xs text-amber-700">
                            now {item.asset.condition}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-lg border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">
              Linked movements ({form.movements.length})
            </h2>
            {form.movements.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No movements cite this form yet. Record them from{" "}
                <Link href="/admin/movements" className="text-primary hover:underline">
                  Movements
                </Link>{" "}
                and pick this form there.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {form.movements.map((movement) => (
                  <li key={movement.id} className="flex items-center justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate">{movement.asset.name}</span>
                      <span className="block font-mono text-xs text-muted-foreground">
                        {movement.referenceNumber} · {movement.movementType}
                      </span>
                    </span>
                    <Link
                      href={`/admin/assets/${movement.asset.id}`}
                      className="shrink-0 text-xs text-primary hover:underline"
                    >
                      View asset
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* ── Right: PDF + scan ── */}
        <div className="space-y-4">
          <section className="rounded-lg border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Document preview</h2>
              <button
                type="button"
                onClick={() => void loadPdf()}
                disabled={pdfLoading || form.status === "CANCELLED"}
                className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted/50 disabled:opacity-50"
              >
                {pdfLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                {pdfUrl ? "Refresh" : "Generate preview"}
              </button>
            </div>

            {form.status === "DRAFT" && (
              <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Generating the preview issues this form: the letter number goes
                on paper and the content is locked from further editing.
              </p>
            )}

            {pdfUrl ? (
              <iframe
                src={pdfUrl}
                title={`Handover form ${form.formNumber}`}
                className="h-[520px] w-full rounded-md border"
              />
            ) : (
              <div className="flex h-[240px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
                {form.status === "CANCELLED"
                  ? "Cancelled forms cannot be rendered."
                  : "No preview loaded yet."}
              </div>
            )}
          </section>

          <section className="rounded-lg border bg-card p-4">
            <h2 className="mb-1 text-sm font-semibold">Signed scan</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              Print the PDF, collect every signature, scan it back as a single
              PDF, and upload it here. Stored behind authentication — it is not
              reachable from a public URL.
            </p>

            {form.scanFileName ? (
              <div className="rounded-md border border-green-200 bg-green-50/50 p-3">
                <p className="text-sm font-medium">{form.scanFileName}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Uploaded{" "}
                  {form.scanUploadedAt
                    ? new Date(form.scanUploadedAt).toLocaleString("id-ID")
                    : "—"}
                  {form.scanUploadedBy ? ` by ${form.scanUploadedBy.name}` : ""}
                </p>
                <div className="mt-2 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={openScan}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Open scan
                  </button>
                  {canUpdate && (
                    <button
                      type="button"
                      onClick={removeScan}
                      className="text-xs font-medium text-muted-foreground hover:text-red-600"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            ) : !scanAllowed ? (
              <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                {form.status === "CANCELLED"
                  ? "This form was cancelled — no scan can be attached."
                  : "Generate and print the PDF first; a scan can only be attached once the form has been issued."}
              </p>
            ) : !canUpdate ? (
              <p className="text-xs text-muted-foreground">
                You do not have permission to upload a scan.
              </p>
            ) : (
              <div className="space-y-3">
                <FileDropzone
                  kind="pdf"
                  file={scanFile}
                  onChange={setScanFile}
                  onError={(message) => toast.error(message)}
                  maxSizeMb={SCAN_MAX_MB}
                  disabled={uploading}
                  data-tour="handover-scan-upload"
                />
                {scanFile && (
                  <button
                    type="button"
                    onClick={uploadScan}
                    disabled={uploading}
                    className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {uploading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4" />
                    )}
                    Upload signed scan
                  </button>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="whitespace-nowrap text-xs text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

function PartyLine({ party, fallback }: { party: HandoverParty | null; fallback: string }) {
  if (!party) return <span className="text-muted-foreground">{fallback}</span>;
  return (
    <>
      <span>{party.name}</span>
      <span className="block text-xs text-muted-foreground">{party.employeeId}</span>
    </>
  );
}

export default function HandoverFormDetailPage() {
  return (
    <ProtectedRoute>
      <HandoverFormDetailContent />
    </ProtectedRoute>
  );
}
