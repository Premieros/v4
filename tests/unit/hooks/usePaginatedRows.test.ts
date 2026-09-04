import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { usePaginatedRows } from '@/hooks/usePaginatedRows';

interface Call {
  table: string;
  range?: [number, number];
  filters: { col: string; val: unknown }[];
  head: boolean;
}

const mockState = vi.hoisted(() => ({
  tables: {} as Record<string, { data: unknown[]; count: number }>,
  errors: {} as Record<string, string>,
  calls: [] as Call[],
}));

const mockSupabase = vi.hoisted(() => {
  class Builder {
    selectOpts?: { count?: 'exact'; head?: boolean };
    rangeFrom?: number;
    rangeTo?: number;
    filters: { col: string; val: unknown }[] = [];
    constructor(public table: string) {}
    select(_col: string, opts?: { count?: 'exact'; head?: boolean }) {
      if (opts) this.selectOpts = opts;
      return this;
    }
    eq(col: string, val: unknown) {
      this.filters.push({ col, val });
      return this;
    }
    order() {
      return this;
    }
    range(from: number, to: number) {
      this.rangeFrom = from;
      this.rangeTo = to;
      return this;
    }
    then(resolve: (v: unknown) => void) {
      const state = mockState.tables[this.table] || { data: [], count: 0 };
      mockState.calls.push({
        table: this.table,
        range: this.selectOpts?.head ? undefined : [this.rangeFrom ?? 0, this.rangeTo ?? 0],
        filters: this.filters,
        head: !!this.selectOpts?.head,
      });
      const fail = mockState.errors[this.table];
      if (fail) {
        return Promise.resolve({ data: null, error: { message: fail } }).then(resolve);
      }
      if (this.selectOpts?.head) {
        return Promise.resolve({ data: null, count: state.count, error: null }).then(resolve);
      }
      const from = this.rangeFrom ?? 0;
      const to = this.rangeTo ?? state.data.length - 1;
      return Promise.resolve({ data: state.data.slice(from, to + 1), error: null }).then(resolve);
    }
  }
  return {
    from: (table: string) => new Builder(table),
  };
});

vi.mock('@/api', () => ({ supabase: mockSupabase }));

function seed(table: string, n: number) {
  mockState.tables[table] = {
    data: Array.from({ length: n }, (_, i) => ({ id: i + 1 })),
    count: n,
  };
}

const dataCalls = (table: string) => mockState.calls.filter((c) => c.table === table && !c.head);
const countCalls = (table: string) => mockState.calls.filter((c) => c.table === table && c.head);

describe('usePaginatedRows', () => {
  beforeEach(() => {
    mockState.tables = {};
    mockState.errors = {};
    mockState.calls = [];
  });

  it('fetches the first page (range 0..pageSize-1) and the exact count', async () => {
    seed('sales', 25);
    const { result } = renderHook(() => usePaginatedRows<{ id: number }>({ table: 'sales', pageSize: 10 }));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.rows).toHaveLength(10);
    expect(result.current.rows[0]).toEqual({ id: 1 });
    expect(result.current.total).toBe(25);
    expect(result.current.hasMore).toBe(true);
    const r = dataCalls('sales')[0].range;
    expect(r).toEqual([0, 9]);
    expect(countCalls('sales')).toHaveLength(1);
  });

  it('applies branch_id and extra equality filters to both data and count queries', async () => {
    seed('orders', 3);
    const { result } = renderHook(() =>
      usePaginatedRows<{ id: number }>({
        table: 'orders',
        branch_id: 'b1',
        filters: [{ column: 'status', value: 'open' }],
      })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(dataCalls('orders').length).toBe(1));

    for (const call of [...dataCalls('orders'), ...countCalls('orders')]) {
      expect(call.filters).toContainEqual({ col: 'branch_id', val: 'b1' });
      expect(call.filters).toContainEqual({ col: 'status', val: 'open' });
    }
  });

  it('loadMore appends the next page and hasMore flips to false when done', async () => {
    seed('sales', 25);
    const { result } = renderHook(() => usePaginatedRows<{ id: number }>({ table: 'sales', pageSize: 10 }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows).toHaveLength(10);

    await act(async () => {
      await result.current.loadMore();
    });
    expect(result.current.rows).toHaveLength(20);
    expect(result.current.hasMore).toBe(true);

    await act(async () => {
      await result.current.loadMore();
    });
    expect(result.current.rows).toHaveLength(25);
    expect(result.current.hasMore).toBe(false);
    expect(dataCalls('sales').map((c) => c.range)).toEqual([
      [0, 9],
      [10, 19],
      [20, 29],
    ]);
  });

  it('refresh reloads from the first page and resets accumulated rows', async () => {
    seed('sales', 25);
    const { result } = renderHook(() => usePaginatedRows<{ id: number }>({ table: 'sales', pageSize: 10 }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.loadMore();
    });
    expect(result.current.rows).toHaveLength(20);

    mockState.tables.sales.count = 30;
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.rows).toHaveLength(10);
    expect(result.current.total).toBe(30);
  });

  it('exposes setRows for optimistic local updates', async () => {
    seed('sales', 25);
    const { result } = renderHook(() => usePaginatedRows<{ id: number }>({ table: 'sales', pageSize: 10 }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      result.current.setRows((prev) => prev.filter((r) => r.id !== 1));
    });
    expect(result.current.rows).toHaveLength(9);
  });

  it('keeps the first page when enabled=false and fires no data request', async () => {
    seed('sales', 5);
    const { result } = renderHook(() =>
      usePaginatedRows<{ id: number }>({ table: 'sales', enabled: false })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows).toHaveLength(0);
    expect(dataCalls('sales')).toHaveLength(0);
  });

  it('surfaces query errors instead of throwing', async () => {
    seed('sales', 5);
    mockState.errors.sales = 'boom';
    const { result } = renderHook(() => usePaginatedRows<{ id: number }>({ table: 'sales' }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('boom');
    expect(result.current.rows).toHaveLength(0);
    expect(result.current.hasMore).toBe(false);
  });
});
