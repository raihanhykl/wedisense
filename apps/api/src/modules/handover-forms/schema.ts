import { z } from 'zod';

export const handoverTypeEnum = z.enum([
  'COMPANY_TO_EMPLOYEE',
  'EMPLOYEE_TO_EMPLOYEE',
  'EMPLOYEE_TO_COMPANY',
]);

export const handoverFormStatusEnum = z.enum(['DRAFT', 'ISSUED', 'SIGNED', 'CANCELLED']);

export const handoverItemSchema = z.object({
  assetId: z.string().uuid(),
  itemNotes: z.string().trim().max(500).nullable().optional(),
});

const baseHandoverFormSchema = z.object({
  handoverType: handoverTypeEnum,
  handoverDate: z.coerce.date(),
  itOfficerUserId: z.string().uuid(),
  fromUserId: z.string().uuid().nullable().optional(),
  toUserId: z.string().uuid().nullable().optional(),
  acknowledgedByUserId: z.string().uuid().nullable().optional(),
  fromLocationId: z.string().uuid().nullable().optional(),
  toLocationId: z.string().uuid().nullable().optional(),
  purpose: z.string().trim().max(500).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  items: z.array(handoverItemSchema).min(1, 'At least one asset is required').max(100),
});

/**
 * Which party fields a form must and must not carry depends entirely on the
 * direction of the handover, so the rules can't live in the field schema.
 * Enforcing "must be absent" as well as "must be present" matters: a
 * COMPANY_TO_EMPLOYEE form carrying a stray `fromUserId` would print a
 * PIHAK PERTAMA block naming an employee who never held the asset.
 */
function refineParties(
  value: {
    handoverType: z.infer<typeof handoverTypeEnum>;
    fromUserId?: string | null;
    toUserId?: string | null;
  },
  ctx: z.RefinementCtx,
): void {
  const { handoverType, fromUserId, toUserId } = value;

  if (handoverType === 'COMPANY_TO_EMPLOYEE') {
    if (!toUserId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['toUserId'],
        message: 'toUserId is required when the company hands an asset to an employee',
      });
    }
    if (fromUserId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fromUserId'],
        message: 'fromUserId must be empty when the company is the handing-over party',
      });
    }
    return;
  }

  if (handoverType === 'EMPLOYEE_TO_COMPANY') {
    if (!fromUserId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fromUserId'],
        message: 'fromUserId is required when an employee returns an asset to the company',
      });
    }
    if (toUserId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['toUserId'],
        message: 'toUserId must be empty when the company is the receiving party',
      });
    }
    return;
  }

  // EMPLOYEE_TO_EMPLOYEE
  if (!fromUserId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['fromUserId'],
      message: 'fromUserId is required for an employee-to-employee handover',
    });
  }
  if (!toUserId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['toUserId'],
      message: 'toUserId is required for an employee-to-employee handover',
    });
  }
  if (fromUserId && toUserId && fromUserId === toUserId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['toUserId'],
      message: 'The handing-over and receiving employees must be different people',
    });
  }
}

function refineUniqueAssets(
  value: { items: Array<{ assetId: string }> },
  ctx: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  value.items.forEach((item, index) => {
    if (seen.has(item.assetId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['items', index, 'assetId'],
        message: 'This asset is already listed on the form',
      });
    }
    seen.add(item.assetId);
  });
}

export const createHandoverFormSchema = baseHandoverFormSchema
  .superRefine(refineParties)
  .superRefine(refineUniqueAssets);

/**
 * Update replaces the form wholesale rather than patching fields: the party
 * rules are cross-field, so validating a partial payload would mean merging
 * with the stored row before it could be checked. Only DRAFT forms are
 * editable anyway (enforced in the service), so re-sending the whole form
 * costs the client nothing.
 */
export const updateHandoverFormSchema = createHandoverFormSchema;

export const cancelHandoverFormSchema = z.object({
  reason: z.string().trim().min(1, 'A cancellation reason is required').max(500),
});

export const listHandoverFormQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  search: z.string().trim().max(200).optional(),
  // Comma-separated so the movement picker can ask for "ISSUED,SIGNED" in
  // one call rather than firing two requests and merging client-side.
  status: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined))
    .pipe(z.array(handoverFormStatusEnum).optional()),
  handoverType: handoverTypeEnum.optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
});

export type CreateHandoverFormInput = z.infer<typeof createHandoverFormSchema>;
export type UpdateHandoverFormInput = z.infer<typeof updateHandoverFormSchema>;
export type CancelHandoverFormInput = z.infer<typeof cancelHandoverFormSchema>;
export type ListHandoverFormQuery = z.infer<typeof listHandoverFormQuerySchema>;
