"use client";

import { useRouter } from "next/navigation";
import ProtectedRoute from "@/components/shared/protected-route";
import AssetForm from "@/components/shared/asset-form";
import { apiPost } from "@/lib/api";
import type { AssetFormData, AssetDetail } from "@/types/admin";

function CreateAssetContent() {
  const router = useRouter();

  const handleSubmit = async (data: AssetFormData) => {
    const created = await apiPost<AssetDetail>("/api/assets", data);
    router.push(`/admin/assets/${created.id}`);
  };

  return (
    <div className="p-6" data-tour="asset-create">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Add Asset</h1>
        <p className="text-sm text-muted-foreground">
          Create a new asset record.
        </p>
      </div>
      <AssetForm onSubmit={handleSubmit} submitLabel="Create Asset" />
    </div>
  );
}

export default function CreateAssetPage() {
  return (
    <ProtectedRoute permission="assets:create">
      <CreateAssetContent />
    </ProtectedRoute>
  );
}
