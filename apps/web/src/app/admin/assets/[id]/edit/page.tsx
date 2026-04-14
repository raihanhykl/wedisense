"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import ProtectedRoute from "@/components/shared/protected-route";
import AssetForm from "@/components/shared/asset-form";
import { apiGet, apiPut } from "@/lib/api";
import type { AssetFormData, AssetDetail } from "@/types/admin";

function EditAssetContent() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [asset, setAsset] = useState<AssetDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAsset = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<AssetDetail>(`/api/assets/${params.id}`);
      setAsset(data);
    } catch {
      // handle error
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    void fetchAsset();
  }, [fetchAsset]);

  const handleSubmit = async (data: AssetFormData) => {
    await apiPut<AssetDetail>(`/api/assets/${params.id}`, data);
    router.push(`/admin/assets/${params.id}`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <p className="text-sm text-muted-foreground">Loading asset...</p>
      </div>
    );
  }

  if (!asset) {
    return (
      <div className="flex flex-col items-center justify-center p-12">
        <p className="text-sm text-muted-foreground">Asset not found.</p>
        <button
          type="button"
          onClick={() => router.push("/admin/assets")}
          className="mt-4 text-sm text-primary hover:underline"
        >
          Back to Assets
        </button>
      </div>
    );
  }

  const defaultValues: AssetFormData = {
    productId: asset.product?.id ?? "",
    name: asset.name,
    serialNumber: asset.serialNumber ?? "",
    locationId: asset.location.id,
    assignedToUserId: asset.assignedTo?.id ?? "",
    status: asset.status,
    condition: asset.condition,
    purchaseDate: asset.purchaseDate ?? "",
    purchasePrice: asset.purchasePrice ?? "",
    vendor: asset.vendor ?? "",
    invoiceNumber: asset.invoiceNumber ?? "",
    warrantyStartDate: asset.warrantyStartDate ?? "",
    warrantyEndDate: asset.warrantyEndDate ?? "",
    usefulLifeMonths: asset.usefulLifeMonths?.toString() ?? "",
    notes: asset.notes ?? "",
  };

  return (
    <div className="p-6" data-tour="asset-edit">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Edit Asset</h1>
        <p className="text-sm text-muted-foreground">
          Update asset: {asset.assetNumber}
        </p>
      </div>
      <AssetForm
        defaultValues={defaultValues}
        onSubmit={handleSubmit}
        submitLabel="Save Changes"
      />
    </div>
  );
}

export default function EditAssetPage() {
  return (
    <ProtectedRoute permission="assets:update">
      <EditAssetContent />
    </ProtectedRoute>
  );
}
