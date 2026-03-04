export type PaginatedResult<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
};
