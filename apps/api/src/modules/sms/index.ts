/**
 * SMS — Stock Management System. Mounted at /api/sms (after `authenticate`).
 *
 * Design: docs/specs/sms-technical-design.md
 *
 * Layout: each sub-folder is a self-contained router → service → repository
 * slice. Shared building blocks live in ./lib:
 *   access.ts       per-location authorization (assertCan)
 *   unit-state.ts   the pure unit state machine
 *   ledger.ts       the only write path for unit state + events
 *   idempotency.ts  exactly-once mutations
 *   transaction.ts  transaction wrapper with lock-conflict handling
 *   audit.ts        audit rows
 */
import { Router, type Router as RouterType } from 'express';
import { loadSmsAccess } from './lib/access.js';
import { smsContextRouter } from './context-router.js';
import { smsMasterRouter } from './master/router.js';
import { smsShipmentsRouter } from './shipments/router.js';
import { smsUnitsRouter } from './units/router.js';
import { smsInspectionsRouter } from './inspections/router.js';
import { smsOpeningBalanceRouter } from './opening-balance/router.js';
import { smsDashboardRouter } from './dashboard/router.js';

const router: RouterType = Router();

// Resolve "which SMS permissions does this user hold at which location"
// once per request; every sub-router relies on req.smsAccess.
router.use(loadSmsAccess);

router.use('/context', smsContextRouter);
router.use('/master', smsMasterRouter);
router.use('/shipments', smsShipmentsRouter);
router.use('/units', smsUnitsRouter);
router.use('/inspections', smsInspectionsRouter);
router.use('/opening-balance', smsOpeningBalanceRouter);
router.use('/dashboard', smsDashboardRouter);

export { router as smsRouter };
