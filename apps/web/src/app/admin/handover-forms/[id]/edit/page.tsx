"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import ProtectedRoute from "@/components/shared/protected-route";
import Breadcrumb from "@/components/shared/breadcrumb";
import HandoverFormFields from "@/components/handover/handover-form-fields";
import { apiGet } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/error";
import { HANDOVER_STATUS_LABELS, isEditable } from "@/lib/handover";
import type { HandoverFormDetail } from "@/types/admin";

function EditHandoverFormContent() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [form, setForm] = useState<HandoverFormDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchForm = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<HandoverFormDetail>(`/api/handover-forms/${id}`);
      if (!isEditable(data.status)) {
        // The server would reject the save anyway; bouncing here avoids
        // letting someone fill in a whole form that can never be submitted.
        toast.error(
          `This form is ${HANDOVER_STATUS_LABELS[data.status].toLowerCase()} and can no longer be edited.`,
        );
        router.replace(`/admin/handover-forms/${id}`);
        return;
      }
      setForm(data);
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

  if (loading || !form) {
    return (
      <div className="flex items-center justify-center p-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <Breadcrumb
        items={[
          { label: "Handover Forms", href: "/admin/handover-forms" },
          { label: form.formNumber, href: `/admin/handover-forms/${form.id}` },
          { label: "Edit" },
        ]}
      />

      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Edit draft</h1>
        <p className="font-mono text-sm text-muted-foreground">{form.formNumber}</p>
      </div>

      <div className="max-w-4xl">
        <HandoverFormFields existing={form} />
      </div>
    </div>
  );
}

export default function EditHandoverFormPage() {
  return (
    <ProtectedRoute>
      <EditHandoverFormContent />
    </ProtectedRoute>
  );
}
