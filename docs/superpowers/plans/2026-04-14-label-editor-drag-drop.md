# Label Editor with Drag-and-Drop & Live Preview

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to implement this plan.

**Goal:** Replace the current form-only label template editor with a full-page visual editor featuring drag-and-drop field positioning and live preview with real asset data.

**Architecture:** Full-page editor at `/admin/print/editor` with three panels: field palette (left), canvas with live preview (center), property panel (right). Canvas renders a scaled representation of the label at actual paper dimensions. Fields are draggable on the canvas. Clicking a field selects it and shows its properties in the right panel. Preview uses a real asset from the database.

**Tech Stack:** React 18, native HTML5 drag-and-drop + mouse events (no extra libraries), Tailwind CSS, existing API endpoints.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/web/src/app/admin/print/editor/page.tsx` | Full-page editor route (new or edit template) |
| `apps/web/src/components/label-editor/editor-canvas.tsx` | The visual canvas that renders label at scale with draggable fields |
| `apps/web/src/components/label-editor/field-palette.tsx` | Left sidebar: draggable field types to add to canvas |
| `apps/web/src/components/label-editor/property-panel.tsx` | Right sidebar: edit selected field properties |
| `apps/web/src/components/label-editor/types.ts` | Editor-specific types |
| `apps/web/src/app/admin/print/page.tsx` | Modify: link to editor instead of dialog |

## Tasks

### Task 1: Editor types and page shell

- Create `apps/web/src/components/label-editor/types.ts` with EditorField type (extends LabelField with `id` for tracking)
- Create `apps/web/src/app/admin/print/editor/page.tsx` — full-page editor with three-panel layout
- Accepts `?id=xxx` query param for editing existing template
- Header with template name input, paper size inputs, save button, back button

### Task 2: Field Palette (left panel)

- Create `apps/web/src/components/label-editor/field-palette.tsx`
- Shows draggable cards for each field type: Barcode, QR Code, Text, Asset Field, Divider
- For "Asset Field" type: shows sub-items for each asset field (asset_number, serial_number, name, location, assigned_to, purchase_date, warranty_end_date)
- Drag from palette → drop on canvas creates new field at drop position

### Task 3: Editor Canvas (center panel)

- Create `apps/web/src/components/label-editor/editor-canvas.tsx`
- Renders a white rectangle at actual paper proportions (scaled to fit container)
- Each field rendered as a positioned element on the canvas
- Fields are draggable within the canvas (mouse drag to reposition)
- Click field to select it (blue border highlight)
- Shows field content: barcode placeholder image, QR placeholder, text with label, asset field with sample data
- Drop zone for palette items
- Grid/ruler optional

### Task 4: Property Panel (right panel)

- Create `apps/web/src/components/label-editor/property-panel.tsx`
- Shows when a field is selected on canvas
- Editable properties: x, y (update in real-time as you type), width, font_size, bold, label
- For "field" type: dropdown to select which asset field to display
- For "text" type: text input for custom_value
- Delete field button
- Changes reflect immediately on canvas

### Task 5: Wire save + load + preview asset data

- Save: collect all fields from editor state → POST/PUT to API
- Load: if `?id=xxx`, fetch template from API → populate editor
- Fetch a sample asset for live preview (show real data on canvas)
- Link from print page → editor page instead of old dialog

### Task 6: Update print page to use new editor

- Modify print page: "Add Template" and "Edit" buttons navigate to `/admin/print/editor` and `/admin/print/editor?id=xxx`
- Remove old label-template-dialog.tsx import (keep file for now, just unlink)
