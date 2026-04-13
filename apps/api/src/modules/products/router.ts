import { Router, type Router as RouterType } from 'express';
import { asyncHandler } from '../../utils/async-handler.js';
import { sendSuccess, sendCreated } from '../../utils/response.js';
import { authorize } from '../../middleware/authorize.js';
import { paginationSchema } from '@wedisense/shared';
import { lookupEanSchema, createProductSchema, updateProductSchema } from './schema.js';
import * as productService from './service.js';

const router: RouterType = Router();

// POST /api/products/lookup — EAN lookup: internal → UPCitemdb → Go-UPC
router.post(
  '/lookup',
  asyncHandler(async (req, res) => {
    const { ean } = lookupEanSchema.parse(req.body);
    const result = await productService.lookupEan(ean);
    sendSuccess(res, result);
  }),
);

// GET /api/products — list products (paginated, searchable)
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const pagination = paginationSchema.parse(req.query);
    const search = req.query['search'] as string | undefined;
    const categoryId = req.query['categoryId'] as string | undefined;
    const { products, meta } = await productService.listProducts({
      ...pagination,
      search,
      categoryId,
    });
    sendSuccess(res, products, 200, meta);
  }),
);

// POST /api/products — create product
router.post(
  '/',
  authorize('assets:create'),
  asyncHandler(async (req, res) => {
    const input = createProductSchema.parse(req.body);
    const product = await productService.createProduct(input, req.user!.id);
    sendCreated(res, product);
  }),
);

// GET /api/products/:id — get single product
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const product = await productService.getProduct(id);
    sendSuccess(res, product);
  }),
);

// PUT /api/products/:id — update product
router.put(
  '/:id',
  authorize('assets:update'),
  asyncHandler(async (req, res) => {
    const id = req.params['id'] as string;
    const input = updateProductSchema.parse(req.body);
    const product = await productService.updateProduct(id, input, req.user!.id);
    sendSuccess(res, product);
  }),
);

export { router as productRouter };
