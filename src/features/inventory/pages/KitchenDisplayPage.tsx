import { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, ChefHat, CheckCircle2, UtensilsCrossed, Volume2, VolumeX } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { DesignSurface, DesignPageHeader } from '@/components/design/DesignSurface';
import { Button } from '@/components/Button';
import { Select } from '@/components/Input';
import { catalog } from '@/api/domains/catalog';
import { subscribePosRealtime } from '@/features/pos/services/posRealtime';
import type { KitchenQueueItem, KitchenStation } from '@/lib/types';

function elapsedColor(seconds: number): string {
  if (seconds > 600) return 'text-ui-danger font-bold';
  if (seconds > 300) return 'text-ui-warning font-semibold';
  return 'text-ui-success';
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function statusBadge(s: string, ar: boolean) {
  if (s === 'cooking') return <span className="rounded-full bg-ui-warning-soft px-2 py-0.5 text-xs font-bold text-ui-warning">{ar ? 'جاري التحضير' : 'Cooking'}</span>;
  if (s === 'ready') return <span className="rounded-full bg-ui-success-soft px-2 py-0.5 text-xs font-bold text-ui-success">{ar ? 'جاهز' : 'Ready'}</span>;
  return <span className="rounded-full bg-ui-info-soft px-2 py-0.5 text-xs font-bold text-ui-info">{ar ? 'جديد' : 'New'}</span>;
}

export function KitchenDisplayPage() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const branchFilter = useBranchFilter();
  const [station, setStation] = useState('');
  const [items, setItems] = useState<KitchenQueueItem[]>([]);
  const [stations, setStations] = useState<KitchenStation[]>([]);
  const [loading, setLoading] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const prevCountRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const loadStations = useCallback(async () => {
    try {
      const data = await catalog.listKitchenStations();
      setStations((data ?? []) as KitchenStation[]);
    } catch { /* silent */ }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await catalog.getKitchenQueue(station || undefined);
      const newItems = (data ?? []) as KitchenQueueItem[];
      if (soundEnabled && prevCountRef.current > 0 && newItems.length > prevCountRef.current) {
        playBeep();
      }
      prevCountRef.current = newItems.length;
      setItems(newItems);
    } catch { /* silent */ }
    setLoading(false);
  }, [station, soundEnabled]);

  const playBeep = () => {
    try {
      if (!audioRef.current) {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 800;
        gain.gain.value = 0.3;
        osc.start();
        osc.stop(ctx.currentTime + 0.15);
      }
    } catch { /* silent */ }
  };

  useEffect(() => { void loadStations(); }, [loadStations]);
  useEffect(() => { void load(); }, [load]);

  // Real-time: subscribe to order changes instead of polling
  useEffect(() => {
    if (!branchFilter) return;
    const unsubscribe = subscribePosRealtime({
      branchId: branchFilter,
      onEvent: () => { void load(); },
      debounceMs: 500,
    });
    return unsubscribe;
  }, [branchFilter, load]);

  // Fallback polling every 30 seconds (real-time handles primary updates)
  useEffect(() => {
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  const handleKitchenStatus = async (orderId: string, status: string) => {
    try {
      await catalog.setKitchenStatus(orderId, status);
      void load();
    } catch { /* silent — toast would be noisy in kitchen */ }
  };

  const stationName = (v: string) => {
    const s = stations.find(st => st.code === v);
    if (s) return ar ? s.name_ar : s.name_en;
    return v;
  };

  return (
    <DesignSurface testId="kitchen-display">
      <DesignPageHeader title={ar ? 'شاشة المطبخ' : 'Kitchen Display'} subtitle={ar ? 'متابعة الطلبات حسب محطة المطبخ — تحديث مباشر' : 'Live kitchen order tracking — real-time updates'} />
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Select value={station} onChange={e => setStation(e.target.value)} className="w-44">
            <option value="">{ar ? 'كل المحطات' : 'All Stations'}</option>
            {stations.filter(s => s.is_active).map(s => <option key={s.code} value={s.code}>{ar ? s.name_ar : s.name_en}</option>)}
          </Select>
          <Button onClick={load} variant="outline"><RefreshCw className="h-4 w-4" /> {ar ? 'تحديث' : 'Refresh'}</Button>
          <button onClick={() => setSoundEnabled(!soundEnabled)} className="rounded-lg p-2 text-ui-muted hover:bg-ui-muted/10 transition" title={soundEnabled ? (ar ? 'كتم الصوت' : 'Mute') : (ar ? 'تشغيل الصوت' : 'Unmute')}>
            {soundEnabled ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
          </button>
          <span className="text-sm text-ui-muted">
            <span className="inline-block w-2 h-2 rounded-full bg-ui-success mr-1 animate-pulse" />
            {items.length} {ar ? 'طلب' : 'orders'}
          </span>
        </div>

        {loading && !items.length && <div className="text-ui-muted py-8 text-center">{ar ? 'جاري التحميل...' : 'Loading...'}</div>}

        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map(item => (
            <div key={item.order_id} className={`rounded-2xl border bg-ui-surface p-4 shadow-ui-sm transition-all ${
              item.kitchen_status === 'cooking' ? 'border-ui-warning/40 ring-1 ring-ui-warning' :
              item.kitchen_status === 'ready' ? 'border-ui-success/40 ring-1 ring-ui-success' :
              'border-ui-border'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-ui-text text-lg">#{item.order_number}</span>
                <div className="flex items-center gap-2">
                  {statusBadge(item.kitchen_status, ar)}
                  <span className={`text-sm ${elapsedColor(item.elapsed_seconds)}`}>
                    {formatElapsed(item.elapsed_seconds)}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 mb-3 text-sm text-ui-muted flex-wrap">
                <span className="rounded bg-ui-primary-soft px-2 py-0.5 text-ui-primary font-semibold">{stationName(item.station)}</span>
                {item.table_number && <span>{ar ? 'طاولة' : 'T'} {item.table_number}</span>}
                {item.guest_count && <span>{ar ? 'ضيوف' : 'G'}: {item.guest_count}</span>}
              </div>
              <ul className="space-y-1.5 mb-3">
                {item.items.map((it, idx) => (
                  <li key={idx} className="flex items-center justify-between text-sm">
                    <span className="text-ui-text font-medium">{it.product_name}</span>
                    <span className="text-ui-muted font-bold text-base">×{it.quantity}</span>
                  </li>
                ))}
              </ul>
              {item.notes && <div className="text-xs text-ui-muted italic border-t border-ui-border pt-2 mb-3">{item.notes}</div>}

              {/* Kitchen action buttons — large touch targets for tablet */}
              <div className="flex gap-2 border-t border-ui-border pt-3">
                {item.kitchen_status === 'sent' && (
                  <button onClick={() => void handleKitchenStatus(item.order_id, 'cooking')}
                    className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-ui-warning-soft0 text-white py-3 px-4 text-sm font-bold hover:bg-ui-warning active:scale-95 transition-all min-h-[48px]">
                    <ChefHat className="h-5 w-5" /> {ar ? 'بدء التحضير' : 'Start Cooking'}
                  </button>
                )}
                {item.kitchen_status === 'cooking' && (
                  <button onClick={() => void handleKitchenStatus(item.order_id, 'ready')}
                    className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-ui-success text-white py-3 px-4 text-sm font-bold hover:bg-ui-success active:scale-95 transition-all min-h-[48px]">
                    <CheckCircle2 className="h-5 w-5" /> {ar ? 'جاهز للتقديم' : 'Mark Ready'}
                  </button>
                )}
                {item.kitchen_status === 'ready' && (
                  <button onClick={() => void handleKitchenStatus(item.order_id, 'served')}
                    className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-ui-info text-white py-3 px-4 text-sm font-bold hover:bg-ui-info active:scale-95 transition-all min-h-[48px]">
                    <UtensilsCrossed className="h-5 w-5" /> {ar ? 'تم التقديم' : 'Served'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {!loading && !items.length && (
          <div className="text-center py-16 text-ui-muted">
            <ChefHat className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <div className="text-lg">{ar ? 'لا توجد طلبات في المطبخ' : 'No orders in kitchen'}</div>
          </div>
        )}
      </div>
    </DesignSurface>
  );
}
