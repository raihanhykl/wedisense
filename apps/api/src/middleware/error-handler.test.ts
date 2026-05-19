import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { z } from 'zod';
import { AppError, errorHandler } from './error-handler.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal fake Express Response with jest-style spies. */
function makeRes() {
  const json = vi.fn().mockReturnThis();
  const status = vi.fn().mockReturnValue({ json });
  // Mimic Express chaining: res.status(x).json(y)
  return { status, json } as unknown as Response & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
}

function makeReq() {
  return {} as Request;
}

function makeNext() {
  return vi.fn() as unknown as NextFunction;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('AppError', () => {
  it('exposes statusCode, code, and message', () => {
    const err = new AppError(404, 'ASSET_NOT_FOUND', 'Asset not found');
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('ASSET_NOT_FOUND');
    expect(err.message).toBe('Asset not found');
    expect(err).toBeInstanceOf(Error);
  });

  it('exposes optional details array when provided', () => {
    const details = [{ field: 'id', message: 'invalid' }];
    const err = new AppError(422, 'VALIDATION_ERROR', 'Bad input', details);
    expect(err.details).toEqual(details);
  });

  it('has name === "AppError"', () => {
    const err = new AppError(500, 'X', 'msg');
    expect(err.name).toBe('AppError');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('errorHandler() — AppError branch', () => {
  it('returns the AppError statusCode, code, and message', () => {
    const err = new AppError(404, 'ASSET_NOT_FOUND', 'Asset not found');
    const res = makeRes();

    errorHandler(err, makeReq(), res, makeNext());

    expect(res.status).toHaveBeenCalledWith(404);
    const body = (res.status as ReturnType<typeof vi.fn>).mock.results[0]!.value.json.mock.calls[0]![0];
    expect(body).toEqual({
      success: false,
      error: {
        code: 'ASSET_NOT_FOUND',
        message: 'Asset not found',
        details: undefined,
      },
    });
  });

  it('includes details array when present on AppError', () => {
    const details = [{ field: 'productId', message: 'required' }];
    const err = new AppError(422, 'VALIDATION_ERROR', 'Validation failed', details);
    const res = makeRes();

    errorHandler(err, makeReq(), res, makeNext());

    const body = (res.status as ReturnType<typeof vi.fn>).mock.results[0]!.value.json.mock.calls[0]![0];
    expect(body.error.details).toEqual(details);
  });

  it.each([400, 401, 403, 404, 409, 500])('passes through statusCode %i', (statusCode) => {
    const err = new AppError(statusCode, 'ERR', 'msg');
    const res = makeRes();
    errorHandler(err, makeReq(), res, makeNext());
    expect(res.status).toHaveBeenCalledWith(statusCode);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('errorHandler() — ZodError branch', () => {
  it('returns 422 with code VALIDATION_ERROR', () => {
    const schema = z.object({ name: z.string().min(1), age: z.number() });
    let zodErr: ZodError | null = null;
    try {
      schema.parse({ name: '', age: 'not-a-number' });
    } catch (e) {
      zodErr = e as ZodError;
    }

    const res = makeRes();
    errorHandler(zodErr!, makeReq(), res, makeNext());

    expect(res.status).toHaveBeenCalledWith(422);
    const body = (res.status as ReturnType<typeof vi.fn>).mock.results[0]!.value.json.mock.calls[0]![0];
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns field-level details with path and message', () => {
    const schema = z.object({ email: z.string().email() });
    let zodErr: ZodError | null = null;
    try {
      schema.parse({ email: 'not-an-email' });
    } catch (e) {
      zodErr = e as ZodError;
    }

    const res = makeRes();
    errorHandler(zodErr!, makeReq(), res, makeNext());

    const body = (res.status as ReturnType<typeof vi.fn>).mock.results[0]!.value.json.mock.calls[0]![0];
    expect(body.error.details).toBeInstanceOf(Array);
    expect(body.error.details.length).toBeGreaterThan(0);
    const detail = body.error.details[0] as { path: string; message: string; code: string };
    expect(detail).toHaveProperty('path');
    expect(detail).toHaveProperty('message');
    expect(detail).toHaveProperty('code');
  });

  it('includes the first failing field in the message', () => {
    const schema = z.object({ productId: z.string().uuid() });
    let zodErr: ZodError | null = null;
    try {
      schema.parse({ productId: 'bad-uuid' });
    } catch (e) {
      zodErr = e as ZodError;
    }

    const res = makeRes();
    errorHandler(zodErr!, makeReq(), res, makeNext());

    const body = (res.status as ReturnType<typeof vi.fn>).mock.results[0]!.value.json.mock.calls[0]![0];
    expect(body.error.message).toContain('productId');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('errorHandler() — generic Error branch', () => {
  const originalEnv = process.env['NODE_ENV'];

  afterEach(() => {
    process.env['NODE_ENV'] = originalEnv;
  });

  it('returns 500 with code INTERNAL_SERVER_ERROR', () => {
    const err = new Error('Something broke');
    const res = makeRes();

    errorHandler(err, makeReq(), res, makeNext());

    expect(res.status).toHaveBeenCalledWith(500);
    const body = (res.status as ReturnType<typeof vi.fn>).mock.results[0]!.value.json.mock.calls[0]![0];
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_SERVER_ERROR');
  });

  it('in development: returns the actual error message', () => {
    process.env['NODE_ENV'] = 'development';
    const err = new Error('Raw internal message');
    const res = makeRes();

    errorHandler(err, makeReq(), res, makeNext());

    const body = (res.status as ReturnType<typeof vi.fn>).mock.results[0]!.value.json.mock.calls[0]![0];
    expect(body.error.message).toBe('Raw internal message');
  });

  it('in production: returns generic text, not the actual message', () => {
    process.env['NODE_ENV'] = 'production';
    const err = new Error('Secret DB password leaked here');
    const res = makeRes();

    errorHandler(err, makeReq(), res, makeNext());

    const body = (res.status as ReturnType<typeof vi.fn>).mock.results[0]!.value.json.mock.calls[0]![0];
    expect(body.error.message).not.toContain('Secret DB password');
    expect(body.error.message).toBe('An unexpected error occurred');
  });

  it('in test env (non-production): returns the actual message', () => {
    // vitest sets NODE_ENV=test by default
    process.env['NODE_ENV'] = 'test';
    const err = new Error('test-visible message');
    const res = makeRes();

    errorHandler(err, makeReq(), res, makeNext());

    const body = (res.status as ReturnType<typeof vi.fn>).mock.results[0]!.value.json.mock.calls[0]![0];
    expect(body.error.message).toBe('test-visible message');
  });
});
