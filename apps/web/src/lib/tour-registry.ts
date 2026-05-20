/**
 * Static registry of all `data-tour="..."` attribute values currently in the
 * codebase. The admin tour-step editor reads from this list for its target
 * picker dropdown.
 *
 * Maintenance contract: when a developer adds a new `data-tour="some-key"`
 * to any page or component, append the value (alphabetically) to
 * TOUR_TARGET_REGISTRY below. CI checks for registry/attribute parity are
 * deferred to Tier 8.
 */

export interface TourTargetEntry {
  value: string;
  description?: string;
}

export const TOUR_TARGET_REGISTRY: TourTargetEntry[] = [
  { value: "add-asset-btn", description: "Button to create a new asset" },
  { value: "add-asset-category-btn", description: "Button to add an asset category" },
  { value: "add-location-btn", description: "Button to add a location" },
  { value: "add-role-btn", description: "Button to add a new role" },
  { value: "add-row-btn", description: "Button to add a row in multi-asset form" },
  { value: "add-user-btn", description: "Button to add a user" },
  { value: "asset-categories-table", description: "Asset categories table" },
  { value: "asset-create", description: "Asset creation page/form" },
  { value: "asset-detail", description: "Asset detail page" },
  { value: "asset-edit", description: "Asset edit form" },
  { value: "asset-import", description: "Asset import feature" },
  { value: "asset-list", description: "Asset list table" },
  { value: "asset-rows", description: "Rows in multi-asset create form" },
  { value: "asset-search", description: "Asset search input" },
  { value: "barcode-scanner", description: "Barcode scanner component" },
  { value: "bulk-actions-bar", description: "Bulk actions floating bar" },
  { value: "category-filter", description: "Category filter dropdown" },
  { value: "columns-menu", description: "Column visibility menu" },
  { value: "confirm-import-btn", description: "Button to confirm asset import" },
  { value: "create-report-btn", description: "Button to create a report" },
  { value: "dashboard-alerts", description: "Dashboard alerts panel" },
  { value: "dashboard-charts", description: "Dashboard charts section" },
  { value: "dashboard-recent-movements", description: "Dashboard recent movements widget" },
  { value: "dashboard-summary", description: "Dashboard summary metrics" },
  { value: "download-import-template-btn", description: "Download import template button" },
  { value: "download-report-btn", description: "Button to download a report" },
  { value: "export-assets-btn", description: "Button to export assets" },
  { value: "generate-report-btn", description: "Button to generate a report" },
  { value: "import-assets-btn", description: "Button to start asset import" },
  { value: "import-file-input", description: "File input for asset import" },
  { value: "label-printing", description: "Label printing section" },
  { value: "location-tree", description: "Location tree view" },
  { value: "location-tree-picker", description: "Location tree picker component" },
  { value: "login-form", description: "Login form" },
  { value: "maintenance", description: "Maintenance page" },
  { value: "mark-all-read-btn", description: "Button to mark all notifications as read" },
  { value: "movement-list", description: "Movement list table" },
  { value: "new-product-btn", description: "Button to create a new product" },
  { value: "notification-bell", description: "Notification bell icon" },
  { value: "notification-read-filter", description: "Notification read/unread filter" },
  { value: "notification-type-filter", description: "Notification type filter" },
  { value: "notifications-page", description: "Notifications page" },
  { value: "report-create", description: "Report creation form" },
  { value: "report-detail", description: "Report detail page" },
  { value: "report-detail-download-btn", description: "Download button on report detail" },
  { value: "report-detail-generate-btn", description: "Generate button on report detail" },
  { value: "report-name-input", description: "Report name input field" },
  { value: "report-type-filter", description: "Report type filter" },
  { value: "report-type-select", description: "Report type select dropdown" },
  { value: "reports-list", description: "Reports list table" },
  { value: "role-management", description: "Role management page" },
  { value: "save-report-btn", description: "Button to save a report" },
  { value: "saved-views-menu", description: "Saved views menu" },
  { value: "scan-product-btn", description: "Button to scan a product barcode" },
  { value: "sidebar-nav", description: "Sidebar navigation" },
  { value: "status-filter", description: "Status filter dropdown" },
  { value: "upload-validate-btn", description: "Button to upload and validate import file" },
  { value: "user-management", description: "User management page" },
  { value: "user-search", description: "User search input" },
];

export const TOUR_TARGET_VALUES: string[] = TOUR_TARGET_REGISTRY.map((e) => e.value);
