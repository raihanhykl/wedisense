/**
 * Build-time feature flags. Static constants here are intentional — they
 * inline at build time so dead branches drop out of the bundle entirely.
 * Flip a flag, rebuild, ship. No env vars, no runtime config, no surprise
 * states from misconfigured deploys.
 *
 * When a flag's lifecycle ends (feature accepted permanently OR removed),
 * delete the flag entirely along with the dead branch — flags that linger
 * forever turn into untested rot.
 */

/**
 * In-app onboarding tours (NextStep.js + admin authoring + tour-sync job).
 *
 * Disposition (decided in tier-1 review):
 * - This is an internal asset-management tool with a small, trained user
 *   base. Live training has proven more effective than in-app tours for
 *   this audience, and tours added friction (autostart on every login,
 *   maintenance burden) without clear payoff.
 * - Phase 15 code is kept dormant rather than ripped out — flipping this
 *   flag to true restores the entire feature, and the Tier-2 codegen +
 *   i18n parity checks still run in CI so the dormant code doesn't rot.
 *
 * When OFF (current state):
 * - TourProvider skips the /api/tours/my fetch and the autostart effect.
 *   The NextStep engine stays mounted (zero render cost when no steps).
 * - The "Tours" item in the admin sidebar is filtered out.
 * - The "Restart Tutorial" section on /admin/profile is hidden.
 * - /admin/tours/* pages still load if URL-accessed — they just become
 *   inert (no tours to author for an audience that won't see them).
 *
 * Flip to true to re-enable end-to-end. No DB migration or seed change
 * required; the backend has always been ready.
 */
export const TOURS_ENABLED = false;
