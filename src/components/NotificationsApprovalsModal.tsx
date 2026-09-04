import { useState } from 'react';
import {
  Bell,
  CheckCircle,
  XCircle,
  Clock,
  Printer,
  Trash2,
  Percent,
  AlertCircle,
  Check,
  X,
  User,
  Hash,
} from 'lucide-react';
import { usePosApprovals } from '@/features/pos/hooks/usePosApprovals';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { formatCurrency } from '@/lib/format';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function NotificationsApprovalsModal({ open, onClose }: Props) {
  const { lang } = useLanguage();
  const isAr = lang === 'ar';
  const { requests, pendingRequests, canApprove, approve, reject } = usePosApprovals();
  const { show } = useToast();
  const [activeTab, setActiveTab] = useState<'pending' | 'history'>('pending');
  const [processingId, setProcessingId] = useState<string | null>(null);

  if (!open) return null;

  const displayList = activeTab === 'pending'
    ? pendingRequests
    : requests.filter((r) => r.status !== 'pending');

  const handleAction = async (id: string, action: 'approve' | 'reject') => {
    setProcessingId(id);
    try {
      const ok = action === 'approve' ? await approve(id) : await reject(id);
      if (ok) {
        show(
          action === 'approve'
            ? (isAr ? 'تمت الموافقة بنجاح' : 'Approved successfully')
            : (isAr ? 'تم رفض الطلب' : 'Request rejected'),
          action === 'approve' ? 'success' : 'info'
        );
      }
    } catch {
      show(isAr ? 'حدث خطأ أثناء المعالجة' : 'Processing failed', 'error');
    } finally {
      setProcessingId(null);
    }
  };

  const getRequestBadge = (type: string) => {
    switch (type) {
      case 'discount':
        return {
          label: isAr ? 'طلب خصم' : 'Discount',
          icon: <Percent className="w-4 h-4" />,
          color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border-blue-200',
        };
      case 'reprint':
        return {
          label: isAr ? 'طلب إعادة طباعة' : 'Reprint',
          icon: <Printer className="w-4 h-4" />,
          color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 border-amber-200',
        };
      case 'cancel':
      case 'void':
        return {
          label: isAr ? 'طلب إلغاء طلب' : 'Cancel Order',
          icon: <Trash2 className="w-4 h-4" />,
          color: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300 border-rose-200',
        };
      default:
        return {
          label: type,
          icon: <AlertCircle className="w-4 h-4" />,
          color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200',
        };
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div
        dir={isAr ? 'rtl' : 'ltr'}
        className="relative w-full max-w-2xl max-h-[85vh] bg-ui-surface border border-ui-border rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-scale-up"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-ui-border bg-ui-page-alt/50">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-ui-primary/10 text-ui-primary">
              <Bell className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-black text-ui-text">
                {isAr ? 'مركز الإشعارات والموافقات' : 'Notifications & Approvals Center'}
              </h2>
              <p className="text-xs text-ui-subtle">
                {isAr
                  ? 'موافقات الخصومات، وإعادة الطباعة، وإلغاء الطلبات'
                  : 'Approvals for discounts, bill reprints, and order cancellations'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-ui-muted hover:bg-ui-page-alt transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-ui-border bg-ui-surface px-6 pt-2">
          <button
            onClick={() => setActiveTab('pending')}
            className={`flex items-center gap-2 pb-3 px-4 text-sm font-bold border-b-2 transition-all ${
              activeTab === 'pending'
                ? 'border-ui-primary text-ui-primary'
                : 'border-transparent text-ui-muted hover:text-ui-text'
            }`}
          >
            <Clock className="w-4 h-4" />
            <span>{isAr ? 'طلبات قيد المراجعة' : 'Pending Requests'}</span>
            {pendingRequests.length > 0 && (
              <span className="px-2 py-0.5 rounded-full text-xs font-black bg-ui-danger text-white animate-pulse">
                {pendingRequests.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('history')}
            className={`flex items-center gap-2 pb-3 px-4 text-sm font-bold border-b-2 transition-all ${
              activeTab === 'history'
                ? 'border-ui-primary text-ui-primary'
                : 'border-transparent text-ui-muted hover:text-ui-text'
            }`}
          >
            <CheckCircle className="w-4 h-4" />
            <span>{isAr ? 'سجل القرارات السابقة' : 'Approval History'}</span>
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {displayList.length === 0 ? (
            <div className="py-12 text-center text-ui-muted">
              <CheckCircle className="w-12 h-12 mx-auto mb-3 opacity-30 text-ui-success" />
              <p className="font-semibold text-sm">
                {activeTab === 'pending'
                  ? (isAr ? 'لا توجد طلبات معلقة تتطلب الموافقة حالياً' : 'No pending approval requests')
                  : (isAr ? 'لا يوجد سجل سابق' : 'No history records found')}
              </p>
            </div>
          ) : (
            displayList.map((req) => {
              const badge = getRequestBadge(req.request_type);
              const isProcessing = processingId === req.id;

              return (
                <div
                  key={req.id}
                  className="p-4 rounded-xl border border-ui-border bg-ui-page hover:border-ui-border-strong transition-all shadow-sm space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <span
                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-black border ${badge.color}`}
                      >
                        {badge.icon}
                        {badge.label}
                      </span>
                      {req.order_number && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-ui-subtle bg-ui-page-alt px-2.5 py-1 rounded-lg border border-ui-border">
                          <Hash className="w-3.5 h-3.5" />
                          {req.order_number}
                        </span>
                      )}
                    </div>

                    <span className="text-[11px] text-ui-subtle flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      {new Date(req.created_at).toLocaleTimeString(isAr ? 'ar-EG' : 'en-US', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>

                  {/* Body & Reasons */}
                  <div className="text-sm space-y-1.5">
                    <div className="flex items-center gap-2 text-xs text-ui-muted">
                      <User className="w-3.5 h-3.5 text-ui-primary" />
                      <span>{isAr ? 'مقدم الطلب (الكاشير):' : 'Requested by:'}</span>
                      <strong className="text-ui-text">{req.cashier_name || 'كاشير'}</strong>
                    </div>

                    {req.amount !== null && req.amount !== undefined && (
                      <div className="text-sm font-bold text-ui-text">
                        {isAr ? 'قيمة الخصم المطلوبة: ' : 'Requested discount: '}
                        <span className="text-ui-primary text-base">
                          {formatCurrency(req.amount, 'EGP', lang)}
                        </span>
                      </div>
                    )}

                    {req.reason && (
                      <div className="p-2.5 rounded-lg bg-ui-surface border border-ui-border text-xs text-ui-text font-medium">
                        <span className="text-ui-subtle">{isAr ? 'السبب: ' : 'Reason: '}</span>
                        {req.reason}
                      </div>
                    )}
                  </div>

                  {/* Actions or Status */}
                  <div className="pt-2 border-t border-ui-border flex items-center justify-between gap-3">
                    {req.status === 'pending' ? (
                      canApprove ? (
                        <div className="flex items-center gap-2 ms-auto">
                          <button
                            disabled={isProcessing}
                            onClick={() => handleAction(req.id, 'reject')}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-rose-300 dark:border-rose-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-xs font-bold transition-all disabled:opacity-50"
                          >
                            <X className="w-4 h-4" />
                            {isAr ? 'رفض' : 'Reject'}
                          </button>
                          <button
                            disabled={isProcessing}
                            onClick={() => handleAction(req.id, 'approve')}
                            className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black shadow-sm transition-all disabled:opacity-50"
                          >
                            <Check className="w-4 h-4" />
                            {isAr ? 'موافقة واعتماد' : 'Approve'}
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs font-bold text-amber-600 bg-amber-50 dark:bg-amber-950/40 px-3 py-1 rounded-lg border border-amber-200 ms-auto">
                          {isAr ? 'في انتظار قرار المشرف...' : 'Waiting for supervisor decision...'}
                        </span>
                      )
                    ) : (
                      <div className="flex items-center gap-2 text-xs font-bold ms-auto">
                        {req.status === 'approved' ? (
                          <span className="flex items-center gap-1 text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-1 rounded-lg border border-emerald-200">
                            <CheckCircle className="w-3.5 h-3.5" />
                            {isAr ? `معتمد من ${req.approved_by_name || 'المشرف'}` : `Approved by ${req.approved_by_name || 'Supervisor'}`}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-rose-600 bg-rose-50 dark:bg-rose-950/30 px-3 py-1 rounded-lg border border-rose-200">
                            <XCircle className="w-3.5 h-3.5" />
                            {isAr ? `مرفوض من ${req.approved_by_name || 'المشرف'}` : `Rejected by ${req.approved_by_name || 'Supervisor'}`}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
