/**
 * Computes a shallow diff between two objects, returning only changed fields.
 * Used by audit middleware to log before/after values.
 */
export function objectDiff(
  oldObj: Record<string, unknown>,
  newObj: Record<string, unknown>,
): { oldValues: Record<string, unknown>; newValues: Record<string, unknown> } {
  const oldValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};

  const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);

  for (const key of allKeys) {
    const oldVal = oldObj[key];
    const newVal = newObj[key];

    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      oldValues[key] = oldVal;
      newValues[key] = newVal;
    }
  }

  return { oldValues, newValues };
}
