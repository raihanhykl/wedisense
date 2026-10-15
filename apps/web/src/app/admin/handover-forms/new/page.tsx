"use client";

import ProtectedRoute from "@/components/shared/protected-route";
import Breadcrumb from "@/components/shared/breadcrumb";
import HandoverFormFields from "@/components/handover/handover-form-fields";

function NewHandoverFormContent() {
  return (
    <div className="p-6">
      <Breadcrumb
        items={[
          { label: "Handover Forms", href: "/admin/handover-forms" },
          { label: "New" },
        ]}
      />

      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">New handover form</h1>
        <p className="text-sm text-muted-foreground">
          Saving creates a draft and allocates its letter number. You can still
          edit a draft; generating the PDF locks it for signature.
        </p>
      </div>

      <div className="max-w-4xl">
        <HandoverFormFields />
      </div>
    </div>
  );
}

export default function NewHandoverFormPage() {
  return (
    <ProtectedRoute>
      <NewHandoverFormContent />
    </ProtectedRoute>
  );
}
