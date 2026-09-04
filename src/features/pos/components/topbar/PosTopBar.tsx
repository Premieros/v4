import { useEffect, useState, useCallback } from 'react';
import { Plus, Wifi, WifiOff, Timer, Moon, Sun, LogOut, Clock3, MoreHorizontal, ListOrdered, RefreshCw, CalendarCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/context/LanguageContext';
import { useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import { Logo } from '@/components/Logo';
import type { Branch } from '@/lib/types';
import type { ActiveShiftInfo } from '../../hooks/usePosOrder';
import { offlinePosManager } from '../../services/offlinePos';

export type PosPanelId = 'orders' | 'tables' | 'kitchen' | null;

interface PosTopBarProps {
  panel: PosPanelId;
  onPanel: (p: Exclude<PosPanelId, null>) => void;
  counts: {
    activeOrders: number;
    occupiedTables: number;
    kitchenOrders: number;
    heldOrders: number;
    deliveryOrders: number;
    takeawayOrders: number;
  };
  branchId: string;
  branches: Branch[];
  canChangeBranch: boolean;
  onBranchChange: (id: string) => void;
  isCashier: boolean;
  shiftChecked: boolean;
  activeShift: ActiveShiftInfo | null;
  onNewOrder: () => void;
  onExit: () => void;
  onOpenShiftModal?: () => void;
}

export function PosTopBar({
  onPanel,
  counts,
  branchId,
  branches,
  canChangeBranch,
  onBranchChange,
  isCashier,
  shiftChecked,
  activeShift,
  onNewOrder,
  onExit,
  onOpenShiftModal,
}: PosTopBarProps) {
  const { t, lang } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const isAr = lang === 'ar';

  const [now, setNow] = useState(() => new Date());
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [more, setMore] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const refreshPending = useCallback(() => {
    setPendingCount(offlinePosManager.getPendingCount());
  }, []);

  const triggerSync = useCallback(async () => {
    if (syncing || !navigator.onLine) return;
    setSyncing(true);
    try {
      await offlinePosManager.syncAllPending();
    } finally {
      setSyncing(false);
      refreshPending();
    }
  }, [syncing, refreshPending]);

  useEffect(() => {
    refreshPending();
    const id = setInterval(() => setNow(new Date()), 30000);

    const on = () => {
      setOnline(true);
      void triggerSync();
    };
    const off = () => setOnline(false);

    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    window.addEventListener('storage', refreshPending);

    return () => {
      clearInterval(id);
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      window.removeEventListener('storage', refreshPending);
    };
  }, [refreshPending, triggerSync]);

  return (
    <header className="sticky top-0 z-50 flex min-h-16 items-center gap-2 border-b border-ui-border bg-ui-surface px-3 shadow-ui-sm md:px-4">
      {/* Brand & New Order */}
      <div className="flex shrink-0 items-center gap-2">
        <Logo variant="mark" size={34} tone="auto" />
        <div className="hidden leading-tight sm:block">
          <p className="text-sm font-black text-ui-text">Premier</p>
          <p className="text-[9px] font-black uppercase tracking-[.16em] text-ui-accent">{t('pos')}</p>
        </div>
        <button
          onClick={onNewOrder}
          data-testid="pos-action-new-order"
          className="flex min-h-10 items-center gap-1.5 rounded-xl bg-ui-primary px-3 text-xs font-black text-ui-primary-fg shadow-ui-sm transition active:scale-95 hover:bg-ui-primary-hover"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">{t('newOrder')}</span>
        </button>
      </div>

      <div className="flex-1" />

      {/* Offline Pending Sales Sync Indicator */}
      {pendingCount > 0 && (
        <button
          onClick={triggerSync}
          disabled={syncing || !online}
          className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-black transition animate-pulse ${
            online
              ? 'border-amber-500/40 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20'
              : 'border-ui-danger/40 bg-ui-danger/10 text-ui-danger'
          }`}
          title={isAr ? 'فواتير تم حفظها أثناء انقطاع النت في انتظار المزامنة' : 'Queued offline sales pending sync'}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
          <span>
            {pendingCount} {isAr ? 'فواتير أوفلاين معلقة' : 'offline sales queued'}
            {online && !syncing && ` (${isAr ? 'مزامنة' : 'Sync'})`}
          </span>
        </button>
      )}

      {/* Online / Offline Status Badge */}
      <div
        className={`hidden items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[10px] font-black xl:flex ${
          online
            ? 'border-ui-success/30 bg-ui-success/10 text-ui-success'
            : 'border-ui-danger/30 bg-ui-danger/10 text-ui-danger'
        }`}
      >
        {online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
        {online ? t('online') : (isAr ? 'أوفلاين (جاهز)' : t('offline'))}
      </div>

      {/* Clock */}
      <div className="hidden items-center gap-1.5 rounded-xl border border-ui-border bg-ui-page-alt px-2.5 py-1.5 text-[10px] font-bold text-ui-muted lg:flex">
        <Clock3 className="h-3 w-3 text-ui-subtle" />
        {now.toLocaleTimeString(isAr ? 'ar-EG' : 'en-US', { hour: '2-digit', minute: '2-digit' })}
      </div>

      {/* Shift / Day Closing Status Button */}
      {isCashier && shiftChecked && (
        <button
          onClick={() => {
            if (onOpenShiftModal) {
              onOpenShiftModal();
            } else {
              navigate('/shifts');
            }
          }}
          className={`min-h-9 items-center gap-1.5 rounded-xl border px-3 text-[11px] font-black flex transition hover:shadow-ui-sm ${
            activeShift
              ? 'border-ui-success/40 bg-ui-success/10 text-ui-success hover:bg-ui-success/20'
              : 'border-ui-warning/40 bg-ui-warning/10 text-ui-warning hover:bg-ui-warning/20'
          }`}
          title={isAr ? 'إدارة وإغلاق اليوم والوردية' : 'Manage Shift & Day Close'}
        >
          <Timer className="h-3.5 w-3.5" />
          <span>{activeShift ? (isAr ? 'الوردية نشطة (إغلاق اليوم)' : t('open')) : t('noOpenShift')}</span>
        </button>
      )}

      {/* More Actions Menu */}
      <div className="relative">
        <button
          onClick={() => setMore((v) => !v)}
          aria-label={isAr ? 'المزيد' : 'More'}
          className="flex min-h-10 min-w-10 items-center justify-center rounded-xl border border-ui-border bg-ui-surface text-ui-muted hover:bg-ui-page-alt"
        >
          <MoreHorizontal className="h-5 w-5" />
        </button>

        {more && (
          <div className="absolute end-0 top-12 z-50 w-64 rounded-2xl border border-ui-border bg-ui-surface p-2 shadow-ui-xl">
            <div className="mb-1 px-3 py-2 text-xs font-black text-ui-subtle">
              {isAr ? 'إجراءات إضافية' : 'More actions'}
            </div>
            <button
              onClick={() => {
                onPanel('orders');
                setMore(false);
              }}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold hover:bg-ui-page-alt"
            >
              <ListOrdered className="h-4 w-4" />
              {t('activeOrders')}{' '}
              {counts.activeOrders > 0 && (
                <span className="ms-auto rounded-full bg-ui-primary px-2 py-0.5 text-[10px] text-ui-primary-fg">
                  {counts.activeOrders}
                </span>
              )}
            </button>
            <button
              onClick={() => {
                if (onOpenShiftModal) {
                  onOpenShiftModal();
                } else {
                  navigate('/shifts');
                }
                setMore(false);
              }}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold hover:bg-ui-page-alt"
            >
              <CalendarCheck className="h-4 w-4 text-ui-accent" />
              {isAr ? 'إغلاق اليوم والوردية (Z-Report)' : 'Day & Shift Closing'}
            </button>
            {canChangeBranch && (
              <>
                <div className="my-1 h-px bg-ui-border" />
                <div className="px-3 py-1.5 text-[11px] text-ui-subtle">{isAr ? 'الفرع' : 'Branch'}</div>
                <select
                  value={branchId}
                  onChange={(e) => {
                    onBranchChange(e.target.value);
                    setMore(false);
                  }}
                  className="w-full rounded-xl border border-ui-border bg-ui-page-alt px-3 py-2 text-sm font-bold text-ui-text"
                >
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {isAr ? b.name : b.name_en || b.name}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
        )}
      </div>

      {/* User Info */}
      <div className="hidden items-center gap-2 lg:flex">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-ui-primary text-xs font-black text-ui-primary-fg ring-1 ring-ui-border-strong">
          {(user?.full_name || user?.email || '?')[0].toUpperCase()}
        </div>
        <div className="max-w-[120px] leading-tight">
          <p className="truncate text-[11px] font-black text-ui-text">{user?.full_name || user?.email}</p>
          <p className="text-[9px] text-ui-subtle">{user?.role}</p>
        </div>
      </div>

      {/* Theme Toggle */}
      <button
        onClick={toggleTheme}
        aria-label={isAr ? 'تغيير المظهر' : 'Toggle theme'}
        className="flex min-h-10 min-w-10 items-center justify-center rounded-xl text-ui-muted hover:bg-ui-page-alt"
      >
        {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
      </button>

      {/* Exit */}
      <button
        onClick={onExit}
        aria-label={isAr ? 'خروج' : 'Exit'}
        className="hidden min-h-10 min-w-10 items-center justify-center rounded-xl text-ui-muted hover:bg-ui-page-alt sm:flex"
      >
        <LogOut className="h-4 w-4 rotate-180" />
      </button>

      {/* Sign Out */}
      <button
        onClick={() => void signOut()}
        aria-label={isAr ? 'تسجيل الخروج' : 'Sign out'}
        className="flex min-h-10 min-w-10 items-center justify-center rounded-xl text-ui-subtle hover:bg-ui-danger/10 hover:text-ui-danger"
      >
        <LogOut className="h-4 w-4" />
      </button>
    </header>
  );
}
