import { useEffect, useState } from 'react';
import { Percent, Printer, Trash2, Clock, CheckCircle, XCircle, X } from 'lucide-react';
import { supabase } from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import {
  type PosApprovalType,
  type PosApprovalRequest,
  createApprovalRequest,
} from '../../services/approvals';

interface Props {
  open: boolean;
  onClose: () => void;
  branchId: string;
  orderId?: string | null;
  orderNumber?: string | null;
  type: PosApprovalType;
  initialAmount?: number;
  currency?: string;
  onApproved: (req: PosApprovalRequest) => void;
}

export function RequestApprovalDialog({
  open,
  onClose,
  branchId,
  orderId,
  orderNumber,
  type,
  initialAmount,
  currency = 'EGP',
  onApproved,
}: Props) {
  const { lang } = useLanguage();
  const isAr = lang === 'ar';
  const { user } = useAuth();

  const [amount, setAmount] = useState<number>(initialAmount || 0);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [pendingReqId, setPendingReqId] = useState<string | null>(null);
  const [requestStatus, setRequestStatus] = useState<'idle' | 'waiting' | 'approved' | 'rejected'>('idle');
  const [approvedBy, setApprovedBy] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setAmount(initialAmount || 0);
      setReason('');
      setSubmitting(false);
      setPendingReqId(null);
      setRequestStatus('idle');
      setApprovedBy(null);
    }
  }, [open, initialAmount]);

  // Listen in real-time to the created approval request
  useEffect(() => {
    if (!pendingReqId) return;

    const channel = supabase
      .channel(`approval_req_${pendingReqId}_${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'pos_approval_requests',
          filter: `id=eq.${pendingReqId}`,
        },
        (payload) => {
          const updated = payload.new as PosApprovalRequest;
          if (updated.status === 'approved') {
            setRequestStatus('approved');
            setApprovedBy(updated.approved_by_name || 'المشرف');
            setTimeout(() => {
              onApproved(updated);
              onClose();
            }, 1200);
          } else if (updated.status === 'rejected') {
            setRequestStatus('rejected');
            setApprovedBy(updated.approved_by_name || 'المشرف');
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [pendingReqId, onApproved, onClose]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const req = await createApprovalRequest({
        branch_id: branchId,
        order_id: orderId,
        order_number: orderNumber,
        cashier_id: user?.id,
        cashier_name: user?.full_name || user?.username || user?.email || 'كاشير',
        request_type: type,
        amount: type === 'discount' ? Number(amount) : null,
        reason: reason.trim(),
      });

      if (req) {
        setPendingReqId(req.id);
        setRequestStatus('waiting');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const getTitle = () => {
    switch (type) {
      case 'discount':
        return {
          title: isAr ? 'طلب موافقة على تطبيق خصم' : 'Request Discount Approval',
          icon: <Percent className="w-5 h-5 text-blue-500" />,
        };
      case 'reprint':
        return {
          title: isAr ? 'طلب موافقة على إعادة الطباعة' : 'Request Reprint Approval',
          icon: <Printer className="w-5 h-5 text-amber-500" />,
        };
      case 'cancel':
      case 'void':
        return {
          title: isAr ? 'طلب موافقة على إلغاء الطلب' : 'Request Cancel Order Approval',
          icon: <Trash2 className="w-5 h-5 text-rose-500" />,
        };
    }
  };

  const header = getTitle();

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 animate-fade-in">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div
        dir={isAr ? 'rtl' : 'ltr'}
        className="relative w-full max-w-md bg-ui-surface border border-ui-border rounded-2xl shadow-2xl p-6 overflow-hidden animate-scale-up"
      >
        <div className="flex items-center justify-between pb-4 border-b border-ui-border mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-ui-page-alt border border-ui-border">
              {header.icon}
            </div>
            <div>
              <h3 className="text-base font-black text-ui-text">{header.title}</h3>
              {orderNumber && (
                <p className="text-xs text-ui-subtle">
                  {isAr ? `الطلب رقم: #${orderNumber}` : `Order #${orderNumber}`}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-ui-muted hover:bg-ui-page-alt"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {requestStatus === 'idle' ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            {type === 'discount' && (
              <div>
                <label className="block text-xs font-bold text-ui-subtle mb-1.5">
                  {isAr ? `قيمة الخصم المطلوبة (${currency})` : `Requested Discount Amount (${currency})`}
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  required
                  value={amount || ''}
                  onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                  placeholder="0.00"
                  className="w-full px-4 py-2.5 rounded-xl border border-ui-border bg-ui-page text-ui-text font-bold text-lg focus:outline-none focus:border-ui-primary"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-ui-subtle mb-1.5">
                {isAr ? 'سبب الطلب (للمشرف)' : 'Reason for request'}
              </label>
              <textarea
                required
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={
                  type === 'discount'
                    ? (isAr ? 'مثال: خصم لعميل دائم، أو عرض خاص معتمد' : 'e.g., VIP customer discount')
                    : type === 'reprint'
                    ? (isAr ? 'مثال: طلب العميل نسخة ثانية من الفاتورة' : 'e.g., Customer requested extra copy')
                    : (isAr ? 'مثال: خطأ في إدخال الطاولة أو إلغاء من العميل' : 'e.g., Customer canceled')
                }
                className="w-full px-4 py-2 rounded-xl border border-ui-border bg-ui-page text-ui-text text-sm focus:outline-none focus:border-ui-primary resize-none"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-ui-border">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-bold text-ui-muted hover:bg-ui-page-alt"
              >
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2.5 rounded-xl bg-ui-primary hover:bg-ui-primary-hover text-ui-primary-fg text-xs font-black shadow-md disabled:opacity-50 transition-all"
              >
                {submitting
                  ? (isAr ? 'جاري الإرسال...' : 'Submitting...')
                  : (isAr ? 'إرسال طلب الموافقة' : 'Send for Approval')}
              </button>
            </div>
          </form>
        ) : requestStatus === 'waiting' ? (
          <div className="py-8 text-center space-y-4">
            <div className="w-14 h-14 mx-auto rounded-full bg-amber-50 dark:bg-amber-950/40 border border-amber-200 flex items-center justify-center text-amber-600 animate-pulse">
              <Clock className="w-7 h-7" />
            </div>
            <div>
              <h4 className="text-sm font-black text-ui-text">
                {isAr ? 'تم إرسال الطلب للمشرف بنجاح' : 'Request sent to supervisor'}
              </h4>
              <p className="text-xs text-ui-subtle mt-1 max-w-xs mx-auto">
                {isAr
                  ? 'تم إشعار المشرفين عبر مركز الإشعارات، سيتم تنفيذ طلبك تلقائياً بمجرد الاعتماد.'
                  : 'Supervisors have been notified. Your action will execute automatically upon approval.'}
              </p>
            </div>
            <div className="flex justify-center">
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-ui-page-alt border border-ui-border text-xs font-bold text-ui-muted">
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
                {isAr ? 'في انتظار قرار المشرف...' : 'Waiting for decision...'}
              </span>
            </div>
            <button
              onClick={onClose}
              className="text-xs text-ui-muted hover:underline mt-2"
            >
              {isAr ? 'إغلاق ومتابعة العمل' : 'Close and continue'}
            </button>
          </div>
        ) : requestStatus === 'approved' ? (
          <div className="py-8 text-center space-y-3">
            <div className="w-14 h-14 mx-auto rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 flex items-center justify-center text-emerald-600">
              <CheckCircle className="w-8 h-8" />
            </div>
            <h4 className="text-sm font-black text-emerald-600">
              {isAr ? 'تمت الموافقة بنجاح!' : 'Approved!'}
            </h4>
            <p className="text-xs text-ui-subtle">
              {isAr ? `تم الاعتماد بواسطة: ${approvedBy}` : `Approved by ${approvedBy}`}
            </p>
          </div>
        ) : (
          <div className="py-8 text-center space-y-3">
            <div className="w-14 h-14 mx-auto rounded-full bg-rose-50 dark:bg-rose-950/40 border border-rose-200 flex items-center justify-center text-rose-600">
              <XCircle className="w-8 h-8" />
            </div>
            <h4 className="text-sm font-black text-rose-600">
              {isAr ? 'تم رفض الطلب' : 'Request rejected'}
            </h4>
            <p className="text-xs text-ui-subtle">
              {isAr ? `تم الرفض بواسطة: ${approvedBy}` : `Rejected by ${approvedBy}`}
            </p>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-ui-page-alt border border-ui-border text-xs font-bold text-ui-text"
            >
              {isAr ? 'إغلاق' : 'Close'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
