"use client";

/** Column mapping control for the SMS manifest import wizard (Step 2). */

const FIELD_DEFS: Array<{ key: string; label: string; required: boolean }> = [
  { key: "vin", label: "VIN / Chassis number", required: true },
  { key: "engineNumber", label: "Engine number", required: false },
  { key: "model", label: "Model", required: false },
  { key: "variant", label: "Variant", required: false },
  { key: "color", label: "Colour", required: false },
  { key: "itemType", label: "Item type (to skip components)", required: false },
];

interface ImportManifestColumnMapperProps {
  headers: string[];
  /** Auto-detected mapping: fieldKey → column index (or null = not found). */
  suggestedMapping: Record<string, number | null>;
  /** Current active mapping controlled by the parent. */
  currentMapping: Record<string, number | null>;
  /** Sample data rows (up to 10), each row is an array of string cells. */
  sampleRows: string[][];
  onChange: (mapping: Record<string, number | null>) => void;
}

/**
 * Shows a table with one row per importable field.
 * The user selects which spreadsheet column maps to each field.
 * Columns not listed here (e.g. battery serial numbers) are silently ignored.
 */
export function ImportManifestColumnMapper({
  headers,
  currentMapping,
  sampleRows,
  onChange,
}: ImportManifestColumnMapperProps) {
  const handleChange = (fieldKey: string, rawValue: string) => {
    const colIndex = rawValue === "" ? null : parseInt(rawValue, 10);
    onChange({ ...currentMapping, [fieldKey]: colIndex });
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Match each field to its spreadsheet column. Columns not listed here (e.g. battery
        serial numbers) are ignored.
      </p>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-3 py-2 text-left font-medium text-xs">Field</th>
              <th className="px-3 py-2 text-left font-medium text-xs">Column</th>
              <th className="px-3 py-2 text-left font-medium text-xs">Sample values</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {FIELD_DEFS.map((f) => {
              const colIndex = currentMapping[f.key] ?? null;
              const samples = colIndex !== null
                ? sampleRows
                    .slice(0, 3)
                    .map((row) => row[colIndex] ?? "")
                    .filter(Boolean)
                : [];
              return (
                <tr key={f.key}>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className="font-medium">{f.label}</span>
                    {f.required && (
                      <span className="ml-1 text-destructive text-xs">*</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={colIndex !== null ? String(colIndex) : ""}
                      onChange={(e) => handleChange(f.key, e.target.value)}
                      className="h-8 max-w-[200px] rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      {!f.required && <option value="">— not mapped —</option>}
                      {f.required && colIndex === null && (
                        <option value="" disabled>
                          — select a column —
                        </option>
                      )}
                      {headers.map((h, i) => (
                        <option key={i} value={i}>
                          {h || `Column ${i + 1}`}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 max-w-[200px]">
                    {samples.length > 0 ? (
                      <span className="font-mono text-xs text-muted-foreground truncate block">
                        {samples.join(" · ")}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
