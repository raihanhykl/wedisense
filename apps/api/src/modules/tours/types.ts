/**
 * Tour module types.
 *
 * Storage note: the `steps` JSONB column stores keys in snake_case
 * (`step_index`, `target_element`, `required_permission`, `is_active`).
 * All external API responses use camelCase. `parseStep()` handles the
 * mapping in one place so the rest of the codebase only sees camelCase.
 *
 * We standardise on snake_case in storage (backward-compatible with the
 * existing seed data and the `tour-sync` worker, which already uses
 * snake_case). `toStorageStep()` converts camelCase admin input back to
 * the canonical storage shape before writing.
 */

export type TourStepPosition = 'top' | 'bottom' | 'left' | 'right' | 'auto';

export interface TourStep {
  stepIndex: number;
  title: string;          // i18n key, e.g. "tours.super_admin.dashboard.title"
  description: string;    // i18n key
  targetElement: string;  // CSS selector or [data-tour='xxx'] value
  position: TourStepPosition;
  requiredPermission: { resource: string; action: string } | null;
  route: string;          // e.g. "/admin/assets"
  isActive: boolean;
}

export type TourStepDto = TourStep;

export interface TourProgressDto {
  completedSteps: number[];
  /** Last step index the user was on (derived from completedSteps; 0 if none). */
  lastStepIndex: number;
  isCompleted: boolean;
  isSkipped: boolean;
  lastSeenAt: string | null; // ISO string
}

export interface TourDto {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  roleId: string;
  roleName: string;
  steps: TourStepDto[];
  progress: TourProgressDto | null;
}

// ── Storage shape (snake_case — what lives in the DB JSONB column) ──────────
// This matches what the seed and the tour-sync worker write.

export interface StorageTourStep {
  step_index: number;
  title: string;
  description: string;
  target_element: string;
  position: string;
  required_permission: { resource: string; action: string } | null;
  route: string;
  is_active?: boolean;
}

// ── Mappers ──────────────────────────────────────────────────────────────────

const VALID_POSITIONS = new Set<string>(['top', 'bottom', 'left', 'right', 'auto']);

/**
 * Parse a raw JSON value from the DB into a typed TourStep.
 * Accepts both snake_case (storage) and camelCase (future) shapes.
 * Falls back gracefully on missing/unexpected values.
 */
export function parseStep(raw: unknown): TourStep {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`Invalid step data: expected object, got ${typeof raw}`);
  }
  const r = raw as Record<string, unknown>;

  // Support both snake_case (storage) and camelCase (API input)
  const stepIndex =
    typeof r['step_index'] === 'number' ? r['step_index'] :
    typeof r['stepIndex'] === 'number' ? r['stepIndex'] : 0;

  const title =
    typeof r['title'] === 'string' ? r['title'] : '';

  const description =
    typeof r['description'] === 'string' ? r['description'] : '';

  const targetElement =
    typeof r['target_element'] === 'string' ? r['target_element'] :
    typeof r['targetElement'] === 'string' ? r['targetElement'] : '';

  const rawPosition =
    typeof r['position'] === 'string' ? r['position'] : 'bottom';
  const position: TourStepPosition = VALID_POSITIONS.has(rawPosition)
    ? (rawPosition as TourStepPosition)
    : 'bottom';

  const rawPerm = r['required_permission'] ?? r['requiredPermission'];
  let requiredPermission: { resource: string; action: string } | null = null;
  if (
    rawPerm !== null &&
    typeof rawPerm === 'object' &&
    typeof (rawPerm as Record<string, unknown>)['resource'] === 'string' &&
    typeof (rawPerm as Record<string, unknown>)['action'] === 'string'
  ) {
    requiredPermission = {
      resource: (rawPerm as Record<string, unknown>)['resource'] as string,
      action: (rawPerm as Record<string, unknown>)['action'] as string,
    };
  }

  const route =
    typeof r['route'] === 'string' ? r['route'] : '/';

  const rawActive = r['is_active'] ?? r['isActive'];
  // Default true when the field is absent (legacy seed rows without is_active)
  const isActive = rawActive === undefined ? true : Boolean(rawActive);

  return { stepIndex, title, description, targetElement, position, requiredPermission, route, isActive };
}

/**
 * Convert a camelCase TourStep back to the snake_case storage shape.
 * Used before writing steps to the DB so the tour-sync worker stays compatible.
 */
export function toStorageStep(step: TourStep): StorageTourStep {
  return {
    step_index: step.stepIndex,
    title: step.title,
    description: step.description,
    target_element: step.targetElement,
    position: step.position,
    required_permission: step.requiredPermission,
    route: step.route,
    is_active: step.isActive,
  };
}
