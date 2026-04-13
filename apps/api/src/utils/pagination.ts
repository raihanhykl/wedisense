import { PAGINATION } from '@wedisense/shared';
import type { PaginationMeta, PaginationQuery } from '@wedisense/shared';

export function parsePagination(query: PaginationQuery): {
  skip: number;
  take: number;
  page: number;
  limit: number;
} {
  const page = Math.max(1, query.page ?? PAGINATION.DEFAULT_PAGE);
  const limit = Math.min(
    PAGINATION.MAX_LIMIT,
    Math.max(1, query.limit ?? PAGINATION.DEFAULT_LIMIT),
  );

  return {
    skip: (page - 1) * limit,
    take: limit,
    page,
    limit,
  };
}

export function buildPaginationMeta(
  page: number,
  limit: number,
  total: number,
): PaginationMeta {
  return {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  };
}
