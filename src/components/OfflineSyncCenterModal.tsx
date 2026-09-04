import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, CheckCircle2, AlertCircle, Trash2, Clock } from 'lucide-react';
import { useOffline } from '@/context/OfflineContext';
import { useLanguage } from '@/context/LanguageContext';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';
import { formatCurrency } from '@/lib/format';
import type { OfflineSaleQueueItem } from '@/core/offline/offlineStorage';

interface OfflineSyncCenterModalProps {
  open: boolean;
  onClose: () => void;
}

export function OfflineSyncCenterModal({ open, onClose }: OfflineSyncCenterModalProps) {
  const { isOnline, isSyncing, pendingCount, syncNow, getOfflineQueue, discardQueuedSale, lastSyncTime, lastError } = useOffline();
  const { lang } = useLanguage();
  const isAr = lang === 'ar';

  const [queue, setQueue] = useState<OfflineSaleQueueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const items = await getOfflineQueue();
      setQueue(items);
    } finally {
      setLoading(false);
    }
  }, [getOfflineQueue]);

  useEffect(() => {
    if (open) {
      void loadQueue();
    }
  }, [open, pendingCount, loadQueue]);

  const handleSync = async () => {
    setSyncMessage(null);
    const res = await syncNow();
    if (res.successCount > 0 || res.failedCount > 0) {
      setSyncMessage(
        isAr
          ? `تم مزامنة ${res.successCount} عملية بنجاح. ${res.failedCount > 0 ? `فشل ${res.failedCount}` : ''}`
          : `Synced ${res.successCount} sales. ${res.failedCount > 0 ? `Failed: ${res.failedCount}` : ''}`
      );
    }
    await loadQueue();
  };

  const handleDiscard = async (id: string) => {
    const confirm = window.confirm(
      isAr ? 'هل أنت متأكد من حذف هذه الفاتورة من قائمة الانتظار المحلية؟' : 'Are you sure you want to discard this offline invoice?'
    );
    if (confirm) {
      await discardQueuedSale(id);
      await loadQueue();
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isAr ? 'مركز المزامنة والعمل بدون اتصال (Offline Engine)' : 'Offline Sync Center'}
      size="lg"
    >
      <div className="space-y-5">
        {/* Status card */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="p-4 rounded-xl border border-ui-border bg-ui-page flex items-center gap-3">
            <div className={`p-2.5 rounded-lg ${isOnline ? 'bg-ui-success-soft text-ui-success' : 'bg-ui-danger-soft text-ui-danger'}`}>
              <div className={`w-3 h-3 rounded-full ${isOnline ? 'bg-ui-success animate-pulse' : 'bg-ui-danger'}`} />
            </div>
            <div>
              <p className="text-xs text-ui-subtle">{isAr ? 'حالة الشبكة' : 'Network Status'}</p>
              <p className="text-sm font-bold text-ui-text">{isOnline ? (isAr ? 'متصل بالإنترنت' : 'Online') : (isAr ? 'بدون اتصال (Offline)' : 'Offline')}</p>
            </div>
          </div>

          <div className="p-4 rounded-xl border border-ui-border bg-ui-page flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-brand-500/10 text-brand-600">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-ui-subtle">{isAr ? 'عمليات معلقة' : 'Pending Invoices'}</p>
              <p className="text-sm font-bold text-ui-text">{pendingCount} {isAr ? 'فاتورة' : 'sales'}</p>
            </div>
          </div>

          <div className="p-4 rounded-xl border border-ui-border bg-ui-page flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-ui-info-soft text-ui-info">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-ui-subtle">{isAr ? 'آخر مزامنة' : 'Last Synced'}</p>
              <p className="text-xs font-bold text-ui-text truncate">
                {lastSyncTime ? new Date(lastSyncTime).toLocaleTimeString(isAr ? 'ar-EG' : 'en-US') : (isAr ? 'لم تتم بعد' : 'Not yet')}
              </p>
            </div>
          </div>
        </div>

        {/* Sync message or error */}
        {syncMessage && (
          <div className="p-3 rounded-xl bg-ui-success-soft text-ui-success text-xs font-bold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{syncMessage}</span>
          </div>
        )}

        {lastError && (
          <div className="p-3 rounded-xl bg-ui-danger-soft text-ui-danger text-xs font-bold flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{lastError}</span>
          </div>
        )}

        {/* Action Header */}
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold text-ui-text uppercase tracking-wider">
            {isAr ? 'طابور الفواتير المحلية غير المزامنة' : 'Offline Invoices Queue'}
          </h4>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={loadQueue}
              disabled={loading || isSyncing}
            >
              {isAr ? 'تحديث القائمة' : 'Refresh'}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSync}
              disabled={!isOnline || isSyncing || pendingCount === 0}
              className="gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              {isSyncing ? (isAr ? 'جاري المزامنة...' : 'Syncing...') : (isAr ? 'مزامنة الكل الآن' : 'Sync All Now')}
            </Button>
          </div>
        </div>

        {/* Queue Table */}
        <div className="border border-ui-border rounded-xl overflow-hidden bg-ui-surface">
          {queue.length === 0 ? (
            <div className="py-8 text-center text-ui-subtle text-xs">
              <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-ui-success/60" />
              {isAr ? 'لا توجد فواتير معلقة. جميع العمليات متزامنة بنجاح مع السيرفر.' : 'No pending offline sales. All orders are synchronized.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-start text-xs">
                <thead>
                  <tr className="border-b border-ui-border bg-ui-page text-ui-subtle">
                    <th className="py-2.5 px-3 text-start">{isAr ? 'رقم الفاتورة' : 'Invoice #'}</th>
                    <th className="py-2.5 px-3 text-start">{isAr ? 'التاريخ والوقت' : 'Timestamp'}</th>
                    <th className="py-2.5 px-3 text-start">{isAr ? 'المبلغ' : 'Total'}</th>
                    <th className="py-2.5 px-3 text-start">{isAr ? 'طريقة الدفع' : 'Payment'}</th>
                    <th className="py-2.5 px-3 text-start">{isAr ? 'الحالة' : 'Status'}</th>
                    <th className="py-2.5 px-3 text-end">{isAr ? 'إجراءات' : 'Actions'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ui-border">
                  {queue.map((item) => {
                    const total = typeof item.payload?.p_total === 'number' ? item.payload.p_total : Number(item.payload?.p_total) || 0;
                    const paymentMethod = typeof item.payload?.p_payment_method === 'string' ? item.payload.p_payment_method : 'cash';
                    return (
                    <tr key={item.id} className="hover:bg-ui-page-alt transition">
                      <td className="py-2.5 px-3 font-mono font-bold text-ui-text">
                        {item.invoice_number}
                      </td>
                      <td className="py-2.5 px-3 text-ui-subtle">
                        {new Date(item.created_at).toLocaleTimeString(isAr ? 'ar-EG' : 'en-US')}
                      </td>
                      <td className="py-2.5 px-3 font-bold text-brand-600">
                        {formatCurrency(total, 'EGP')}
                      </td>
                      <td className="py-2.5 px-3 text-ui-text capitalize">
                        {paymentMethod}
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            item.status === 'synced'
                              ? 'bg-ui-success-soft text-ui-success'
                              : item.status === 'syncing'
                              ? 'bg-ui-info-soft text-ui-info animate-pulse'
                              : item.status === 'failed'
                              ? 'bg-ui-danger-soft text-ui-danger'
                              : 'bg-ui-warning-soft text-ui-warning'
                          }`}
                        >
                          {item.status === 'synced'
                            ? (isAr ? 'تمت المزامنة' : 'Synced')
                            : item.status === 'syncing'
                            ? (isAr ? 'جاري الإرسال' : 'Syncing')
                            : item.status === 'failed'
                            ? (isAr ? 'فشل' : 'Failed')
                            : (isAr ? 'في الانتظار' : 'Pending')}
                        </span>
                        {item.error && (
                          <p className="text-[10px] text-ui-danger mt-0.5 truncate max-w-[150px]" title={item.error}>
                            {item.error}
                          </p>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDiscard(item.id)}
                          className="text-ui-danger hover:bg-ui-danger-soft p-1 h-7 w-7"
                          title={isAr ? 'حذف من الطابور' : 'Discard'}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Explanatory notes */}
        <div className="p-3 rounded-xl bg-ui-page border border-ui-border text-[11px] text-ui-subtle leading-relaxed">
          <p className="font-bold text-ui-text mb-1">
            {isAr ? '💡 كيف يعمل وضع الـ Offline في نظام كاشير Premier؟' : '💡 How POS Offline Mode Works:'}
          </p>
          <ul className="list-disc list-inside space-y-1">
            <li>
              {isAr
                ? 'يتم حفظ جميع المنتجات والفئات وبيانات الفرع محلياً في المتصفح تلقائياً عند تحميل الكاشير.'
                : 'All products, categories, stock, and settings are cached automatically in local storage.'}
            </li>
            <li>
              {isAr
                ? 'عند انقطاع الإنترنت، يواصل الكاشير العمل وإتمام الفواتير وطباعة الإيصالات بدون أي توقف.'
                : 'When internet drops, cashiers can continue taking orders and printing receipts without interruption.'}
            </li>
            <li>
              {isAr
                ? 'يتم إدراج الفواتير في طابور محلي آمن ومزامنتها فور عودة الاتصال تلقائياً أو يدوياً عبر هذا المركز.'
                : 'Sales are safely queued in local storage and synced automatically once connection is restored.'}
            </li>
          </ul>
        </div>
      </div>
    </Modal>
  );
}
