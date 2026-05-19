/**
 * Asset Categories CRUD.
 *
 *  GET    /                  — list active categories (any authenticated user)
 *  GET    /:id               — read one (any authenticated user)
 *  POST   /                  — create (categories:manage)
 *  PUT    /:id               — update (categories:manage)
 *  DELETE /:id               — soft delete (categories:manage) — blocked if products / children still reference it
 *
 * The list and read endpoints stay permission-free because the asset import
 * flow and filter dropdowns need the catalog visible to every authenticated
 * user. Mutations are gated behind `categories:manage`, held by SUPER_ADMIN
 * and ADMIN per the default role matrix.
 */
import { Router, type Router as RouterType } from 'express';
import { asyncHandler } from '../../utils/async-handler.js';
import { sendSuccess } from '../../utils/response.js';
import { authorize } from '../../middleware/authorize.js';
import { createCategorySchema, updateCategorySchema } from './schema.js';
import {
  createCategory,
  getCategory,
  softDeleteCategory,
  updateCategory,
  listCategories,
} from './service.js';

const router: RouterType = Router();

// ── GET /api/asset-categories ─────────────────────────────────────
// Two callers:
//   1) Filter dropdowns (asset list, import wizard) — need id+name+code.
//   2) Management page — needs the richer view with product counts and
//      parent info.
// We always return the management shape; it's small enough (<2KB even for
// hundreds of categories) that the filter UI doesn't need a slim variant.
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const categories = await listCategories();
    sendSuccess(res, categories);
  }),
);

// ── GET /api/asset-categories/:id ──────────────────────────────────
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const category = await getCategory(req.params['id'] as string);
    sendSuccess(res, category);
  }),
);

// ── POST /api/asset-categories ─────────────────────────────────────
// Note: the same `prisma` import is left in place because the old listing
// query lived here too. Now all queries route through the service module.
router.post(
  '/',
  authorize('categories:manage'),
  asyncHandler(async (req, res) => {
    const input = createCategorySchema.parse(req.body);
    const category = await createCategory(input, req.user!.id);
    sendSuccess(res, category, 201);
  }),
);

// ── PUT /api/asset-categories/:id ──────────────────────────────────
router.put(
  '/:id',
  authorize('categories:manage'),
  asyncHandler(async (req, res) => {
    const input = updateCategorySchema.parse(req.body);
    const category = await updateCategory(
      req.params['id'] as string,
      input,
      req.user!.id,
    );
    sendSuccess(res, category);
  }),
);

// ── DELETE /api/asset-categories/:id ───────────────────────────────
// Soft-delete only. The service layer blocks deletion when products or
// live children still reference the category — callers get a 409 with
// guidance rather than an opaque FK violation.
router.delete(
  '/:id',
  authorize('categories:manage'),
  asyncHandler(async (req, res) => {
    await softDeleteCategory(req.params['id'] as string, req.user!.id);
    sendSuccess(res, { deleted: true });
  }),
);

export { router as assetCategoryRouter };
