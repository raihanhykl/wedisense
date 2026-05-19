"use client";

import { useRouter } from "next/navigation";
import ProtectedRoute from "@/components/shared/protected-route";
import MultiAssetCreateForm from "@/components/shared/multi-asset-create-form";

function CreateAssetContent() {
  const router = useRouter();

  const handleAllCreated = (assets: Array<{ id: string }>) => {
    // Single-row batch → jump straight to the asset's detail page; multi-row
    // batch → return to the list so the user can see all newly created
    // assets in context.
    if (assets.length === 1 && assets[0]) {
      router.push(`/admin/assets/${assets[0].id}`);
    } else {
      router.push("/admin/assets");
    }
  };

  return (
    <div className="p-6" data-tour="asset-create">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Add Assets</h1>
        <p className="text-sm text-muted-foreground">
          Create one or more assets that share the same metadata. Add a row per asset to capture each name + serial.
        </p>
      </div>
      <MultiAssetCreateForm onAllCreated={handleAllCreated} />
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
