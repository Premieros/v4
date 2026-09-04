import { useCallback, useEffect, useState } from 'react';
import { fetchActiveOrders, EMPTY_POS_REALTIME } from '../services/posOrders';
import { subscribePosRealtime } from '../services/posRealtime';
import type { PosRealtimeData } from '../types';

export interface UsePosRealtimeResult {
  data: PosRealtimeData;
  loading: boolean;
  error: string;
}

export function usePosRealtime(branchId: string): UsePosRealtimeResult {
  const [data, setData] = useState<PosRealtimeData>(EMPTY_POS_REALTIME);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (b: string) => {
    try {
      const snapshot = await fetchActiveOrders(b);
      setData(snapshot);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (!branchId) {
      setData(EMPTY_POS_REALTIME);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    load(branchId).finally(() => { if (!cancelled) setLoading(false); });
    const unsubscribe = subscribePosRealtime({
      branchId,
      onEvent: () => { void load(branchId); },
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [branchId, load]);

  return { data, loading, error };
}
