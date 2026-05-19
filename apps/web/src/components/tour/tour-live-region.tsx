/**
 * TourLiveRegion — sr-only ARIA live region for screen reader announcements.
 *
 * TourPopover writes to this element's textContent on every step change so
 * screen readers announce "Step N of M: Title" without the user having to
 * navigate into the popover.
 *
 * Mounted once at the layout root (inside TourProvider) so it persists
 * across route changes.
 */
export default function TourLiveRegion() {
  return (
    <div
      id="tour-live-region"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    />
  );
}
