import React, { useState } from 'react';
import { Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { useOffline } from '@/context/OfflineContext';
import { useLanguage } from '@/context/LanguageContext';
import { OfflineSyncCenterModal } from '@/components/OfflineSyncCenterModal';

export function OfflineStatusIndicator() {
  const { isOnline, isSyncing, pendingCount } = useOffline();
  const { lang } = useLanguage();
  const isAr = lang === 'ar';
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[10px] font-black transition-all hover:scale-105 ${
          !isOnline
            ? 'border-ui-danger/40 bg-ui-danger/10 text-ui-danger animate-pulse shadow-[0_0_10px_rgba(239,68,68,0.2)]'
            : pendingCount > 0
            ? 'border-ui-warning/40 bg-ui-warning/10 text-ui-warning'
            : 'border-ui-success/30 bg-ui-success/10 text-ui-success'
        }`}
        title={
          isAr
            ? `وضع الاتصال: ${isOnline ? 'أونلاين' : 'أوفلاين'}. اضغط لفتح مركز المزامنة (${pendingCount} معلق)`
            : `Network: ${isOnline ? 'Online' : 'Offline'}. Click for Sync Center (${pendingCount} pending)`
        }
      >
        {isSyncing ? (
          <RefreshCw className="h-3 w-3 animate-spin text-ui-primary" />
        ) : !isOnline ? (
          <WifiOff className="h-3 w-3" />
        ) : (
          <Wifi className="h-3 w-3" />
        )}

        <span>
          {isSyncing
            ? (isAr ? 'مزامنة...' : 'Syncing...')
            : !isOnline
            ? (isAr ? 'أوفلاين (محلي)' : 'Offline')
            : (isAr ? 'متصل' : 'Online')}
        </span>

        {pendingCount > 0 && (
          <span className="ms-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-ui-warning px-1 text-[9px] font-bold text-ui-primary-fg">
            {pendingCount}
          </span>
        )}
      </button>

      <OfflineSyncCenterModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}
