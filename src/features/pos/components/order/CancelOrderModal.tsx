import React, { useState } from 'react';
import { AlertCircle, RotateCcw, Trash2, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/Toast';
import { cancelOrderWithInventoryHandling } from '../../services/kitchen';
import { RequestApprovalDialog } from '../approvals/RequestApprovalDialog';
import type { PosApprovalRequest } from '../../services/approvals';

interface Props {
  open: boolean;
  onClose: () => void;
  orderId: string;
  orderNumber?: string | null;
  branchId: string;
  onSuccess: () => void;
}

export const CancelOrderModal: React.FC<Props> = ({
  open,
  onClose,
  orderId,
  orderNumber,
  branchId,
  onSuccess,
}) => {
  const { lang } = useLanguage();
  const isAr = lang === 'ar';
  const { user } = useAuth();
  const { show } = useToast();

  const isManagerOrAdmin =
    user?.role === 'super_admin' ||
    user?.role === 'owner' ||
    user?.role === 'branch_manager';

  const [isWaste, setIsWaste] = useState<boolean>(false);
  const [reasonCategory, setReasonCategory] = useState<string>('cashier_mistake');
  const [customReason, setCustomReason] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [approvalOpen, setApprovalOpen] = useState<boolean>(false);

  if (!open) return null;

  const getFullReason = (): string => {
    let base = '';
    switch (reasonCategory) {
      case 'cashier_mistake':
        base = isAr ? 'خطأ تسجيل من الكاشير' : 'Cashier registration error';
        break;
      case 'customer_left':
        base = isAr ? 'العميل غادر قبل استلام الطلب' : 'Customer cancelled before receiving';
        break;
      case 'kitchen_waste':
        base = isAr ? 'هالك مطبخ (تلف / احتراق أثناء التحضير)' : 'Kitchen waste (burnt / damaged during prep)';
        break;
      case 'customer_refused':
        base = isAr ? 'رفض العميل بعد التحضير' : 'Customer refused order after preparation';
        break;
      case 'quality_issue':
        base = isAr ? 'مشكلة جودة في الطعام المحضر' : 'Food quality issue';
        break;
      default:
        base = isAr ? 'سبب آخر' : 'Other reason';
        break;
    }
    const extra = customReason.trim();
    const typeLabel = isWaste
      ? (isAr ? '[هالك / ويست]' : '[Waste]')
      : (isAr ? '[ليس هالكاً - إرجاع للمستودع]' : '[Returned to stock]');
    return extra ? `${typeLabel} ${base}: ${extra}` : `${typeLabel} ${base}`;
  };

  const executeCancel = async (approvedById?: string) => {
    setLoading(true);
    try {
      const reasonStr = getFullReason();
      const approver = approvedById || (isManagerOrAdmin ? user?.id : undefined);
      const res = await cancelOrderWithInventoryHandling(
        orderId,
        isWaste,
        reasonStr,
        user?.id,
        approver
      );

      if (!res.success) {
        show(res.error || (isAr ? 'فشل إلغاء الطلب' : 'Failed to cancel order'), 'error');
        return;
      }

      if (isWaste) {
        show(
          isAr
            ? `تم إلغاء الطلب وتسجيل الخامات كـ هالك في صفحة الهالك (التكلفة: ${res.total_waste_cost?.toFixed(2) || 0} ر.س)`
            : `Order cancelled and recorded as waste in Waste Center`,
          'success'
        );
      } else {
        show(
          isAr
            ? 'تم إلغاء الطلب وإرجاع كافة الخامات بنجاح إلى مستودع الفرع'
            : 'Order cancelled and all ingredients returned to branch stock',
          'success'
        );
      }

      onSuccess();
      onClose();
    } catch (err) {
      show(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = () => {
    if (!isManagerOrAdmin) {
      // Cashier must request supervisor/manager approval
      setApprovalOpen(true);
      return;
    }
    void executeCancel();
  };

  return (
    <>
      <Modal
        open={open && !approvalOpen}
        onClose={onClose}
        title={isAr ? 'إلغاء الطلب وتحديد مصير المخزون' : 'Cancel Order & Inventory Disposition'}
      >
        <div className="space-y-5 p-1" dir={isAr ? 'rtl' : 'ltr'}>
          {/* Order Banner */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-ui-subtle/5 border border-ui-border">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-amber-500" />
              <span className="font-semibold text-ui-text">
                {isAr ? 'الطلب رقم:' : 'Order #'}{' '}
                <span className="text-brand-600 font-mono">
                  {orderNumber || orderId.slice(0, 8)}
                </span>
              </span>
            </div>
            {!isManagerOrAdmin && (
              <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600 font-medium">
                <ShieldAlert className="w-3.5 h-3.5" />
                {isAr ? 'يتطلب موافقة المدير' : 'Requires Manager Approval'}
              </span>
            )}
          </div>

          {/* Core Choice: Waste vs Return to Stock */}
          <div>
            <label className="block text-sm font-semibold text-ui-text mb-2.5">
              {isAr ? 'حالة الطلب ومصير الخامات والمكونات:' : 'Inventory & Material Fate:'}
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Option 1: NOT WASTE -> Return to stock */}
              <button
                type="button"
                onClick={() => {
                  setIsWaste(false);
                  if (reasonCategory === 'kitchen_waste' || reasonCategory === 'quality_issue') {
                    setReasonCategory('cashier_mistake');
                  }
                }}
                className={`p-3.5 rounded-xl border text-start transition-all flex flex-col justify-between ${
                  !isWaste
                    ? 'border-emerald-500 bg-emerald-500/10 shadow-sm ring-1 ring-emerald-500/40'
                    : 'border-ui-border bg-ui-surface hover:border-ui-border-hover'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <RotateCcw
                      className={`w-5 h-5 ${!isWaste ? 'text-emerald-600' : 'text-ui-muted'}`}
                    />
                    <span className="font-bold text-sm text-ui-text">
                      {isAr ? 'ليس هالكاً (إرجاع للمستودع)' : 'Not Waste (Return to Stock)'}
                    </span>
                  </div>
                  {!isWaste && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                </div>
                <p className="text-xs text-ui-muted mt-2 leading-relaxed">
                  {isAr
                    ? 'مثل: خطأ تسجيل من الكاشير أو إلغاء العميل قبل التحضير. ترجع الخامات تلقائياً لمستودع الفرع.'
                    : 'Cashier mistake or canceled before prep. Items return to branch stock automatically.'}
                </p>
              </button>

              {/* Option 2: IS WASTE -> Log in waste center */}
              <button
                type="button"
                onClick={() => {
                  setIsWaste(true);
                  if (reasonCategory === 'cashier_mistake') {
                    setReasonCategory('kitchen_waste');
                  }
                }}
                className={`p-3.5 rounded-xl border text-start transition-all flex flex-col justify-between ${
                  isWaste
                    ? 'border-rose-500 bg-rose-500/10 shadow-sm ring-1 ring-rose-500/40'
                    : 'border-ui-border bg-ui-surface hover:border-ui-border-hover'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <Trash2
                      className={`w-5 h-5 ${isWaste ? 'text-rose-600' : 'text-ui-muted'}`}
                    />
                    <span className="font-bold text-sm text-ui-text">
                      {isAr ? 'هالك / ويست (تسجيل في الهالك)' : 'Waste (Record in Waste Log)'}
                    </span>
                  </div>
                  {isWaste && <CheckCircle2 className="w-4 h-4 text-rose-600" />}
                </div>
                <p className="text-xs text-ui-muted mt-2 leading-relaxed">
                  {isAr
                    ? 'مثل: تم تحضير الأكل وتلف أو احترق أو رفضه العميل. تخصم وتسجل في صفحة الهالك ولا ترجع.'
                    : 'Food was prepared and damaged, burnt, or rejected. Logged in Waste Center, not returned.'}
                </p>
              </button>
            </div>
          </div>

          {/* Reason Selection */}
          <div>
            <label className="block text-sm font-semibold text-ui-text mb-1.5">
              {isAr ? 'سبب الإلغاء الرئيسي:' : 'Primary Reason:'}
            </label>
            <select
              value={reasonCategory}
              onChange={(e) => setReasonCategory(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-ui-border bg-ui-surface text-sm text-ui-text focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {!isWaste ? (
                <>
                  <option value="cashier_mistake">
                    {isAr ? 'خطأ تسجيل من الكاشير (رقم طاولة أو صنف خاطئ)' : 'Cashier error (wrong item/table)'}
                  </option>
                  <option value="customer_left">
                    {isAr ? 'العميل غادر أو تراجع قبل بدء التحضير بالمطبخ' : 'Customer left before preparation'}
                  </option>
                  <option value="duplicate_order">
                    {isAr ? 'تكرار الطلب بدون قصد' : 'Accidental duplicate order'}
                  </option>
                  <option value="other">
                    {isAr ? 'سبب آخر غير هالك' : 'Other non-waste reason'}
                  </option>
                </>
              ) : (
                <>
                  <option value="kitchen_waste">
                    {isAr ? 'هالك مطبخ (تلف / احتراق / خطأ طهي)' : 'Kitchen damage / burnt during prep'}
                  </option>
                  <option value="customer_refused">
                    {isAr ? 'رفض العميل استلام الوجبة بعد تحضيرها' : 'Customer refused food after preparation'}
                  </option>
                  <option value="quality_issue">
                    {isAr ? 'مشكلة جودة / خطأ في المكونات بالوجبة المحضرة' : 'Food quality / recipe mismatch'}
                  </option>
                  <option value="dropped_spilled">
                    {isAr ? 'سقوط الوجبة أو انسكابها من الصالة/الجرسون' : 'Dropped or spilled by service team'}
                  </option>
                  <option value="other">
                    {isAr ? 'سبب هدر آخر' : 'Other waste reason'}
                  </option>
                </>
              )}
            </select>
          </div>

          {/* Additional Notes */}
          <div>
            <label className="block text-xs font-medium text-ui-muted mb-1">
              {isAr ? 'ملاحظات تفصيلية أو توضيح إضافي (اختياري):' : 'Additional Notes (Optional):'}
            </label>
            <textarea
              rows={2}
              value={customReason}
              onChange={(e) => setCustomReason(e.target.value)}
              placeholder={
                isAr
                  ? 'أدخل أي تفاصيل إضافية للإدارة أو سجل التدقيق...'
                  : 'Add extra details for auditing...'
              }
              className="w-full px-3 py-2 rounded-xl border border-ui-border bg-ui-surface text-sm text-ui-text focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <Button variant="outline" onClick={onClose} disabled={loading}>
              {isAr ? 'تراجع' : 'Cancel'}
            </Button>
            <Button
              variant={isWaste ? 'danger' : 'primary'}
              onClick={handleConfirm}
              disabled={loading}
              className="gap-2"
            >
              {loading ? (
                <span>{isAr ? 'جاري التنفيذ...' : 'Processing...'}</span>
              ) : isWaste ? (
                <>
                  <Trash2 className="w-4 h-4" />
                  <span>{isAr ? 'تأكيد الإلغاء وتسجيل كهالك' : 'Cancel & Record Waste'}</span>
                </>
              ) : (
                <>
                  <RotateCcw className="w-4 h-4" />
                  <span>{isAr ? 'تأكيد الإلغاء وإرجاع للمخزن' : 'Cancel & Return Stock'}</span>
                </>
              )}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Approval dialog when requested by cashier */}
      <RequestApprovalDialog
        open={approvalOpen}
        onClose={() => setApprovalOpen(false)}
        branchId={branchId}
        orderId={orderId}
        orderNumber={orderNumber}
        type="cancel"
        onApproved={(req: PosApprovalRequest) => {
          setApprovalOpen(false);
          void executeCancel(req.approved_by || req.approved_by_name || 'manager');
        }}
      />
    </>
  );
};
