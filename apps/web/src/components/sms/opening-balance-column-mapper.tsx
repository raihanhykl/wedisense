"use client";

/**
 * Column mapping control for the SMS opening-balance import wizard (Step 2).
 *
 * Fields are grouped by context so the long list stays readable.
 * Required fields are marked with an asterisk.
 */

type FieldDef = { key: string; label: string; required: boolean };

type FieldGroup = { group: string; fields: FieldDef[] };

const FIELD_GROUPS: FieldGroup[] = [
  {
    group: "Unit",
    fields: [
      { key: "vin", label: "VIN / Chassis number", required: true },
      { key: "state", label: "State (kondisi)", required: true },
      { key: "showroom", label: "Showroom / branch", required: false },
      { key: "engineNumber", label: "Engine number", required: false },
      { key: "licensePlate", label: "License plate (nopol)", required: false },
      { key: "model", label: "Model", required: false },
      { key: "variant", label: "Variant", required: false },
      { key: "color", label: "Colour", required: false },
      { key: "notes", label: "Notes", required: false },
    ],
  },
  {
    group: "Booking / sale",
    fields: [
      { key: "spkNumber", label: "SPK number", required: false },
      { key: "customerName", label: "Customer name", required: false },
      { key: "customerPhone", label: "Customer phone", required: false },
      { key: "sales", label: "Sales person", required: false },
    ],
  },
  {
    group: "RTO contract",
    fields: [
      { key: "contractNumber", label: "Contract number", required: false },
      { key: "contractStartDate", label: "Contract start date (YYYY-MM-DD)", required: false },
    ],
  },
  {
    group: "Show unit",
    fields: [
      { key: "eventName", label: "Event name", required: false },
      { key: "eventLocation", label: "Event location", required: false },
      { key: "expectedReturnDate", label: "Expected return date (YYYY-MM-DD)", required: false },
      { key: "pic", label: "PIC (person in charge)", required: false },
    ],
  },
  {
    group: "Custody",
    fields: [
      { key: "heldAtShowroom", label: "Held-at showroom (physical location)", required: false },
    ],
  },
];

interface ObColumnMapperProps {
  headers: string[];
  /** Auto-detected mapping: fieldKey → column index (or null = not found). */
  suggestedMapping: Record<string, number | null>;
  /** Current active mapping controlled by the parent. */
  currentMapping: Record<string, number | null>;
  /** Sample data rows (up to 10), each row is an array of string cells. */
  sampleRows: string[][];
  onChange: (mapping: Record<string, number | null>) => void;
}

export function OpeningBalanceColumnMapper({
  headers,
  currentMapping,
  sampleRows,
  onChange,
}: ObColumnMapperProps) {
  const handleChange = (fieldKey: string, rawValue: string) => {
    const colIndex = rawValue === "" ? null : parseInt(rawValue, 10);
    onChange({ ...currentMapping, [fieldKey]: colIndex });
  };

  return (
    <div className="space-y-5">
      <p className="text-xs text-muted-foreground">
        Match each field to its spreadsheet column. Columns not listed here are
        ignored. Fields marked <span className="text-destructive">*</span> are
        required for every row; the rest depend on the unit&apos;s state.
      </p>

      {FIELD_GROUPS.map((group) => (
        <div key={group.group}>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {group.group}
          </p>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-3 py-2 text-left text-xs font-medium">
                    Field
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium">
                    Column
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium">
                    Sample values
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {group.fields.map((f) => {
                  const colIndex = currentMapping[f.key] ?? null;
                  const samples =
                    colIndex !== null
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
                          <span className="ml-1 text-xs text-destructive">
                            *
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={
                            colIndex !== null ? String(colIndex) : ""
                          }
                          onChange={(e) =>
                            handleChange(f.key, e.target.value)
                          }
                          className="h-8 max-w-[200px] rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                        >
                          {!f.required && (
                            <option value="">— not mapped —</option>
                          )}
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
                          <span className="block truncate font-mono text-xs text-muted-foreground">
                            {samples.join(" · ")}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            —
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
