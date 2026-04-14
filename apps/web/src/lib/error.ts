import axios from "axios";

interface ZodIssue {
  message: string;
  path: (string | number)[];
}

/**
 * Extracts a user-friendly error message from an API error response.
 * Handles both plain error messages and Zod validation error arrays.
 * Falls back to the provided default message if extraction fails.
 */
export function getApiErrorMessage(err: unknown, fallback: string): string {
  if (!axios.isAxiosError(err) || !err.response?.data?.error) {
    return fallback;
  }

  const error = err.response.data.error as { message?: string; details?: unknown[] };

  // Check if details contains Zod validation errors
  if (Array.isArray(error.details) && error.details.length > 0) {
    const issues = error.details as ZodIssue[];
    return issues
      .map((issue) => {
        const field = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
        return `${field}${issue.message}`;
      })
      .join("; ");
  }

  if (error.message) {
    return error.message;
  }

  return fallback;
}
