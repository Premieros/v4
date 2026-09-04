import { supabase } from '@/api';

export interface PosRealtimeOptions {
  branchId: string;
  onEvent: () => void;
  debounceMs?: number;
}

interface SharedChannel {
  channel: ReturnType<typeof supabase.channel>;
  listeners: Set<() => void>;
  timer: ReturnType<typeof setTimeout> | null;
  debounceMs: number;
}

// One realtime channel per branch, ref-counted, so multiple consumers
// (Top Bar badge, Active Orders Center, workspace summary) never create
// duplicate subscriptions.
const sharedChannels = new Map<string, SharedChannel>();

function getSharedChannel(branchId: string, debounceMs: number): SharedChannel {
  const existing = sharedChannels.get(branchId);
  if (existing) return existing;

  const entry: SharedChannel = {
    channel: null as never,
    listeners: new Set(),
    timer: null,
    debounceMs,
  };
  const trigger = () => {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.timer = null;
      entry.listeners.forEach((listener) => listener());
    }, entry.debounceMs);
  };
  entry.channel = supabase
    .channel(`pos-realtime-${branchId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `branch_id=eq.${branchId}` }, trigger)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'dining_tables', filter: `branch_id=eq.${branchId}` }, trigger)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, trigger)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'order_kitchen_sends', filter: `branch_id=eq.${branchId}` }, trigger)
    .subscribe();
  sharedChannels.set(branchId, entry);
  return entry;
}

export function subscribePosRealtime({ branchId, onEvent, debounceMs = 300 }: PosRealtimeOptions): () => void {
  const entry = getSharedChannel(branchId, debounceMs);
  entry.listeners.add(onEvent);

  return () => {
    entry.listeners.delete(onEvent);
    if (entry.listeners.size === 0) {
      if (entry.timer) clearTimeout(entry.timer);
      supabase.removeChannel(entry.channel);
      sharedChannels.delete(branchId);
    }
  };
}
