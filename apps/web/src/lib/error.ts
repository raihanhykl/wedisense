import axios from "axios";

/**
 * Extracts a user-friendly error message from an API error response.
 * Falls back to the provided default message if extraction fails.
 */
export function getApiErrorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err) && err.response?.data?.error?.message) {
    return err.response.data.error.message as string;
  }
  return fallback;
}
