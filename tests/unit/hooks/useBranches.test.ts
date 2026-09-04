import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

interface BranchRow { id: string; name: string; is_active: boolean }

const mockState = vi.hoisted(() => ({
  data: [] as BranchRow[],
  error: null as string | null,
  calls: 0,
}));

const mockSupabase = vi.hoisted(() => ({
  from: () => ({
    select: () => ({
      order: () => new Promise((resolve) => {
        mockState.calls += 1;
        if (mockState.error) {
          resolve({ data: null, error: { message: mockState.error } });
        } else {
          resolve({ data: mockState.data, error: null });
        }
      }),
    }),
  }),
}));

vi.mock('@/api', () => ({ supabase: mockSupabase }));

// Reset the module registry before every test so the hook's module-level
// cache is recreated and each test observes a fresh fetch lifecycle.
beforeEach(() => {
  mockState.data = [];
  mockState.error = null;
  mockState.calls = 0;
  vi.resetModules();
});

async function loadUseBranches() {
  const { useBranches } = await import('@/hooks/useBranches');
  return useBranches;
}

describe('useBranches', () => {
  it('fetches branches once on mount and returns them', async () => {
    mockState.data = [{ id: 'b1', name: 'Main', is_active: true }, { id: 'b2', name: 'Branch 2', is_active: false }];
    const useBranches = await loadUseBranches();
    const { result } = renderHook(() => useBranches());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.branches).toHaveLength(2);
    expect(result.current.error).toBeNull();
    expect(mockState.calls).toBe(1);
  });

  it('serves subsequent hook instances from the module-level cache without refetching', async () => {
    mockState.data = [{ id: 'b1', name: 'Main', is_active: true }];
    const useBranches = await loadUseBranches();
    const first = renderHook(() => useBranches());
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    expect(mockState.calls).toBe(1);

    const second = renderHook(() => useBranches());
    await waitFor(() => expect(second.result.current.branches).toHaveLength(1));
    expect(mockState.calls).toBe(1);
  });

  it('refresh re-fetches and updates the cached list', async () => {
    mockState.data = [{ id: 'b1', name: 'Main', is_active: true }];
    const useBranches = await loadUseBranches();
    const { result } = renderHook(() => useBranches());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockState.data = [{ id: 'b1', name: 'Main', is_active: true }, { id: 'b2', name: 'Branch 2', is_active: true }];
    await act(async () => { await result.current.refresh(); });

    expect(result.current.branches).toHaveLength(2);
    expect(mockState.calls).toBe(2);
  });

  it('surfaces the fetch error and clears it on a later successful refresh', async () => {
    mockState.error = 'connection refused';
    const useBranches = await loadUseBranches();
    const { result } = renderHook(() => useBranches());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('connection refused');
    expect(result.current.branches).toEqual([]);

    mockState.error = null;
    mockState.data = [{ id: 'b1', name: 'Main', is_active: true }];
    await act(async () => { await result.current.refresh(); });
    expect(result.current.error).toBeNull();
    expect(result.current.branches).toHaveLength(1);
  });
});
