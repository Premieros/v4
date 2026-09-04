import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'premier_active_branch';

type Listener = () => void;
const listeners = new Set<Listener>();

function readStorage(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v ? v : null;
  } catch {
    return null;
  }
}

let current: string | null = readStorage();

export function getActiveBranchId(): string | null {
  return current;
}

export function setActiveBranchId(id: string | null): void {
  const next = id || null;
  if (next === current) return;
  current = next;
  try {
    if (current) localStorage.setItem(STORAGE_KEY, current);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage unavailable — keep in-memory value only
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useActiveBranchId(): [string | null, (id: string | null) => void] {
  const value = useSyncExternalStore(subscribe, getActiveBranchId, getActiveBranchId);
  return [value, setActiveBranchId];
}
