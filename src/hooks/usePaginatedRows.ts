import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { supabase } from '@/api';

// Unified, reusable paginated-rows hook (audit M7). Every list/table page that
// previously issued an unbounded `.select('*')` (or a silent `.limit(N)`)
// should use this hook so each HTTP request is capped at `pageSize` rows and
// the user can explicitly load more. Behaviour is intentionally kept simple:
// rows are accumulated across pages (append-on-demand), so the existing
// client-side search/filter keeps working over everything loaded so far.
export interface PaginatedQueryOptions {
  /** Table name, e.g. 'sales'. */
  table: string;
  /** Column list for the data query (supports relations). Default '*' */
  select?: string;
  /** Server-side ordering applied to the data query. */
  order?: { column: string; ascending?: boolean };
  /** Equality filter on branch_id (skipped when null/undefined). */
  branch_id?: string | null;
  /** Additional equality filters: [{ column: 'status', value: 'open' }]. */
  filters?: { column: string; value: unknown }[];
  /** Rows fetched per HTTP request. Default 200. */
  pageSize?: number;
  /** Set to false to keep the hook idle (e.g. no branch selected yet). Default true. */
  enabled?: boolean;
}

export interface UsePaginatedRowsResult<T> {
  rows: T[];
  /** Direct setter so pages can keep optimistic local updates after CRUD. */
  setRows: Dispatch<SetStateAction<T[]>>;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  total: number | null;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
}

type FilterBuilder = ReturnType<ReturnType<typeof supabase.from>['select']>;

export function usePaginatedRows<T>(opts: PaginatedQueryOptions): UsePaginatedRowsResult<T> {
  const { table, select = '*', order, branch_id, filters, pageSize = 200, enabled = true } = opts;
  const filterKey = JSON.stringify(filters ?? []);
  const orderKey = order?.column ?? '';
  const orderAsc = order?.ascending !== false;

  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const gen = useRef(0);

  const applyFilters = useCallback(
    (q: FilterBuilder): FilterBuilder => {
      let bq = q;
      if (branch_id) bq = bq.eq('branch_id', branch_id);
      for (const f of filters ?? []) bq = bq.eq(f.column, f.value);
      return bq;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by stable filterKey; `filters` identity changes each render
    [branch_id, filterKey]
  );

  const buildDataQuery = useCallback(
    (from: number, to: number): FilterBuilder => {
      let q = applyFilters(supabase.from(table).select(select));
      if (order) q = q.order(order.column, { ascending: orderAsc });
      return q.range(from, to);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by stable orderKey/orderAsc; `order` identity changes each render
    [table, select, applyFilters, orderKey, orderAsc]
  );

  const countTotal = useCallback(async (): Promise<number> => {
    const { count } = await applyFilters(supabase.from(table).select('id', { count: 'exact', head: true }));
    return count ?? 0;
  }, [table, applyFilters]);

  const refresh = useCallback(async () => {
    const g = ++gen.current;
    setLoading(true);
    setError(null);
    try {
      const [{ data, error: err }, totalCount] = await Promise.all([buildDataQuery(0, pageSize - 1), countTotal()]);
      if (g !== gen.current) return;
      if (err) {
        setError(err.message);
        setRows([]);
        setTotal(0);
        return;
      }
      setRows((data as T[]) || []);
      setTotal(totalCount);
    } finally {
      if (g === gen.current) setLoading(false);
    }
  }, [buildDataQuery, countTotal, pageSize]);

  const loadMore = useCallback(async () => {
    if (loading || loadingMore) return;
    const g = gen.current;
    setLoadingMore(true);
    try {
      const { data, error: err } = await buildDataQuery(rows.length, rows.length + pageSize - 1);
      if (g !== gen.current) return;
      if (err) {
        setError(err.message);
        return;
      }
      setRows((prev) => [...prev, ...((data as T[]) || [])]);
    } finally {
      if (g === gen.current) setLoadingMore(false);
    }
  }, [buildDataQuery, pageSize, rows.length, loading, loadingMore]);

  useEffect(() => {
    if (!enabled) {
      setRows([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    refresh();
  }, [refresh, enabled]);

  const hasMore = total !== null && rows.length < total;

  return { rows, setRows, loading, loadingMore, error, total, hasMore, loadMore, refresh };
}
