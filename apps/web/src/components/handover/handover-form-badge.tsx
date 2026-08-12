"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FileCheck2, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { apiGetBlob } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/error";
import type { MovementHandoverFormRef } from "@/types/admin";

/**
 * Shows the handover form behind a movement, with a direct link to the signed
 * scan. This is what makes the paper trail visible from the asset history:
 * seeing "moved to Siti" is not evidence, seeing the signed BAST is.
 *
 * The scan sits behind authorize(), so it is fetched as a blob and opened
 * from an object URL — a plain href would send no Authorization header.
 */
export default function HandoverFormBadge({
  form,
  compact,
}: {
  form: MovementHandoverFormRef;
  compact?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const objectUrls = useRef<string[]>([]);

  useEffect(() => {
    const urls = objectUrls.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const openScan = async () => {
    setLoading(true);
    try {
      const blob = await apiGetBlob(`/api/handover-forms/${form.id}/scan`);
      const url = URL.createObjectURL(blob);
      objectUrls.current.push(url);
      window.open(url, "_blank");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Failed to open the signed scan"));
    } finally {
      setLoading(false);
    }
  };

  const signed = Boolean(form.scanFileName);

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-xs">
      <Link
        href={`/admin/handover-forms/${form.id}`}
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${
          signed ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"
        } hover:underline`}
        title={signed ? "Signed handover form" : "Handover form — scan not uploaded yet"}
      >
        {signed ? <FileCheck2 className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
        <span className="font-mono">{form.formNumber}</span>
      </Link>

      {signed ? (
        <button
          type="button"
          onClick={openScan}
          disabled={loading}
          className="inline-flex items-center gap-1 text-primary hover:underline disabled:opacity-50"
        >
          {loading && <Loader2 className="h-3 w-3 animate-spin" />}
          View scan
        </button>
      ) : (
        !compact && <span className="text-muted-foreground">no scan uploaded</span>
      )}
    </span>
  );
}
