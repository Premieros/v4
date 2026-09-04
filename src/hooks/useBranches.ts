import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/api';
import type { Branch } from '@/lib/types';

let cache: Branch[] | null = null;

export function useBranches() {
  const [branches, setBranches] = useState<Branch[]>(cache ?? []);
  const [loading, setLoading] = useState(cache === null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.from('branches').select('*').order('name');
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    cache = (data as Branch[]) || [];
    setBranches(cache);
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (cache !== null) {
      setBranches(cache);
      setLoading(false);
      return;
    }
    refresh();
  }, [refresh]);

  return { branches, loading, error, refresh };
}
