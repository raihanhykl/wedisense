# API conventions for Wedisense AMS

## Response format
All endpoints return:
- Success: `{ "success": true, "data": { ... }, "meta": { "page": 1, "total": 100 } }`
- Error: `{ "success": false, "error": { "code": "ERROR_CODE", "message": "...", "details": [...] } }`

## Module structure
Every API module in `apps/api/src/modules/{name}/` has:
- `router.ts` — Express router, only route definitions + middleware binding
- `service.ts` — all business logic lives here
- `repository.ts` — Prisma queries only, no business logic
- `schema.ts` — Zod schemas for request validation
- `types.ts` — TypeScript types/interfaces for the module

## Route handler pattern
- Wrap all async handlers with `asyncHandler()` — never raw try/catch in routers
- Validate request body/params/query with Zod schema before calling service
- Return consistent response shape using response helper utilities

## Validation
- All input validated at API boundary using Zod schemas
- Zod schemas live in the module's `schema.ts`, shared schemas in `packages/shared/schemas/`
- Never trust client data past the router layer

## Pagination
- All list endpoints support: `page`, `limit`, `sort`, `order` query params
- Default: page=1, limit=20, max limit=100
- Response includes `meta: { page, limit, total, totalPages }`

## Error codes
- Use UPPER_SNAKE_CASE: `ASSET_NOT_FOUND`, `INSUFFICIENT_PERMISSION`, `VALIDATION_ERROR`
- HTTP status codes: 400 validation, 401 unauth, 403 forbidden, 404 not found, 409 conflict, 500 internal

## Authentication & Authorization
- All endpoints require `authenticate` middleware except `POST /api/auth/login`
- Permission checks via `authorize('resource:action')` middleware
- Location scoping applied automatically via `req.user.accessibleLocationIds`
