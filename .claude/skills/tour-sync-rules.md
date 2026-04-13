# Tour sync rules — systemic consistency

## When permissions change
Any call to PUT /api/roles/:id/permissions MUST queue a tour_sync BullMQ job.
The job logic is in: apps/api/src/jobs/tour-sync.job.ts

## What tour_sync does
1. Load onboarding_tours record for the affected role_id
2. For each step with required_permission: check against updated permission set
3. If permission newly GRANTED: add step (if not already present) with is_active=true
4. If permission newly REVOKED: set step is_active=false (do not delete)
5. Write audit log: resource_type="OnboardingTour", action=UPDATE
6. Notify ADMINs: "Tour for role X updated due to permission change"

## Adding a new feature
When implementing any new user-facing action or page:
1. Add data-tour="feature-key" to the primary interactive element
2. Add a tour step to ALL role tours that should see this feature
3. Set required_permission if the feature requires a permission
4. Add i18n keys for title and description in both en and id
