/**
 * Client helpers shared by every Stock Management (SMS) screen.
 *
 * Mutations that change stock are sent with an `Idempotency-Key`. Mint the
 * key ONCE per user intent (when a dialog or form opens) with
 * `newIdempotencyKey()` and reuse it for every retry of that same intent —
 * a double click or a retry after a dropped connection is then recorded
 * exactly once by the server. Mint a new key only after a success, or when
 * the user changes the form and submits something different.
 */
import axios from "axios";
import { SMS_IDEMPOTENCY_HEADER } from "@wedisense/shared";
import api from "@/lib/api";

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

function idempotencyHeaders(key: string): Record<string, string> {
  return { [SMS_IDEMPOTENCY_HEADER]: key };
}

/** POST a stock mutation exactly once. */
export async function smsPost<T>(url: string, data: unknown, idempotencyKey: string): Promise<T> {
  const res = await api.post<ApiEnvelope<T>>(url, data, {
    headers: idempotencyHeaders(idempotencyKey),
  });
  return res.data.data;
}

/** PUT a stock mutation exactly once. */
export async function smsPut<T>(url: string, data: unknown, idempotencyKey: string): Promise<T> {
  const res = await api.put<ApiEnvelope<T>>(url, data, {
    headers: idempotencyHeaders(idempotencyKey),
  });
  return res.data.data;
}

/** POST multipart form data (file upload steps of an import; read-only). */
export async function smsPostForm<T>(url: string, formData: FormData): Promise<T> {
  const res = await api.post<ApiEnvelope<T>>(url, formData, {
    // See apiPostForm in lib/api.ts: the JSON default must be cleared or
    // axios serialises the FormData and the file never leaves the browser.
    headers: { "Content-Type": null },
  });
  return res.data.data;
}

export interface SmsApiError {
  status: number | null;
  code: string | null;
  message: string;
  /** Structured details, e.g. one entry per VIN that blocked the request. */
  details: Array<Record<string, unknown>>;
}

interface ValidationIssue {
  path: string;
  message: string;
}

function isValidationIssue(value: unknown): value is ValidationIssue {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ValidationIssue).message === "string" &&
    typeof (value as ValidationIssue).path === "string"
  );
}

/**
 * Normalise any thrown value into a displayable error.
 *
 * SMS endpoints return `details` in two shapes: validation issues
 * (`{ path, message }`, status 422) and business context (e.g.
 * `{ vin, reason }` per unit). This keeps the server's own message for the
 * latter and appends field-level messages for the former.
 */
export function toSmsError(err: unknown, fallback: string): SmsApiError {
  if (!axios.isAxiosError(err)) {
    return { status: null, code: null, message: fallback, details: [] };
  }
  const status = err.response?.status ?? null;
  const body = err.response?.data as
    | { error?: { code?: string; message?: string; details?: unknown[] } }
    | undefined;
  const error = body?.error;
  if (!error) {
    const message = status === null ? "Could not reach the server. Check your connection and try again." : fallback;
    return { status, code: null, message, details: [] };
  }

  const rawDetails = Array.isArray(error.details) ? error.details : [];
  const issues = rawDetails.filter(isValidationIssue);
  const message =
    error.code === "VALIDATION_ERROR" && issues.length > 0
      ? issues.map((issue) => (issue.path ? `${issue.path}: ${issue.message}` : issue.message)).join("; ")
      : (error.message ?? fallback);

  return {
    status,
    code: error.code ?? null,
    message,
    details: rawDetails.filter(
      (detail): detail is Record<string, unknown> => typeof detail === "object" && detail !== null,
    ),
  };
}

export function smsErrorMessage(err: unknown, fallback: string): string {
  return toSmsError(err, fallback).message;
}

/** True when the server says someone else changed the same data first. */
export function isConflict(err: unknown): boolean {
  return axios.isAxiosError(err) && err.response?.status === 409;
}
