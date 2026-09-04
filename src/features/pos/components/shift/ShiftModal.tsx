import { useState, useEffect } from 'react';
import { Timer, X, AlertCircle, CheckCircle2, Printer, FileText, ShoppingBag, Utensils, CreditCard } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { formatCurrency } from '@/lib/format';
import * as api from '@/api';
import { useToast } from '@/components/Toast';
import { fetchShiftClosingDetails, buildThermalZReportHtml, buildA4ZReportHtml, type ShiftClosingSummary } from '@/features/trade/services/shiftClosingReport';

interface ShiftModalProps {
  isOpen: boolean;
  onClose: () => void;
  branchId?: string;
  activeShift: { id: string; expected: number; opened_at: string; opening_amount: number } | null;
  currency: string;
  onShiftClosed: () => void;
}

export function ShiftModal({
  isOpen,
  onClose,
  branchId,
  activeShift,
  currency,
  onShiftClosed,
}: ShiftModalProps) {
  const { t, lang } = useLanguage();
  const isAr = lang === 'ar';
  const { show } = useToast();

  const [closingCash, setClosingCash] = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  const [closing, setClosing] = useState(false);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [summary, setSummary] = useState<ShiftClosingSummary | null>(null);

  useEffect(() => {
    if (isOpen && activeShift?.id) {
      setLoadingSummary(true);
      fetchShiftClosingDetails(activeShift.id, branchId)
        .then((data) => setSummary(data))
        .catch((err) => console.warn('Could not load live shift summary', err))
        .finally(() => setLoadingSummary(false));
    } else {
      setSummary(null);
    }
  }, [isOpen, activeShift?.id, branchId]);

  if (!isOpen) return null;

  const expectedAmount = summary?.expectedAmount ?? (activeShift?.expected || activeShift?.opening_amount || 0);
  const actualAmount = typeof closingCash === 'number' ? closingCash : 0;
  const difference = typeof closingCash === 'number' ? actualAmount - expectedAmount : 0;

  const handlePrintThermal = () => {
    if (!summary) return;
    const effectiveSummary: ShiftClosingSummary = {
      ...summary,
      actualAmount: typeof closingCash === 'number' ? closingCash : summary.actualAmount,
      difference: typeof closingCash === 'number' ? difference : summary.difference,
      notes: notes || summary.notes,
    };
    const html = buildThermalZReportHtml(effectiveSummary, currency, lang);
    const win = window.open('', '_blank', 'width=380,height=600');
    if (win) {
      win.document.write(html);
      win.document.close();
    }
  };

  const handlePrintA4 = () => {
    if (!summary) return;
    const effectiveSummary: ShiftClosingSummary = {
      ...summary,
      actualAmount: typeof closingCash === 'number' ? closingCash : summary.actualAmount,
      difference: typeof closingCash === 'number' ? difference : summary.difference,
      notes: notes || summary.notes,
    };
    const html = buildA4ZReportHtml(effectiveSummary, currency, lang);
    const win = window.open('', '_blank', 'width=900,height=800');
    if (win) {
      win.document.write(html);
      win.document.close();
    }
  };

  const handleCloseShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeShift) return;
    if (typeof closingCash !== 'number') {
      show(isAr ? 'يرجى إدخال المبلغ الفعلي في الدرج' : 'Please enter actual cash counted', 'error');
      return;
    }

    setClosing(true);
    try {
      const { error } = await api.shifts.close({
        p_shift_id: activeShift.id,
        p_actual_amount: actualAmount,
        p_notes: notes.trim() || null,
      });

      if (error) throw error;

      show(isAr ? 'تم إغلاق الوردية واليوم بنجاح' : 'Shift & Day closed successfully', 'success');
      onShiftClosed();
      onClose();
    } catch (err: unknown) {
      show(err instanceof Error ? err.message : 'Error closing shift', 'error');
    } finally {
      setClosing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ui-text/50 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-ui-border bg-ui-surface shadow-ui-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-ui-border px-6 py-4">
            <div className="flex items-center gap-2">
              <Timer className="h-5 w-5 text-ui-accent" />
              <h3 className="text-base font-black text-ui-text">
                {isAr ? 'إدارة وإغلاق اليوم والوردية (Z-Report)' : 'Day & Shift Closing Management'}
              </h3>
              {loadingSummary && (
                <span className="text-[10px] font-bold text-ui-subtle animate-pulse">
                  ({isAr ? 'جاري تجميع البيانات...' : 'Loading summary...'})
                </span>
              )}
            </div>
          <button
            onClick={onClose}
            aria-label={isAr ? 'إغلاق' : 'Close'}
            className="flex h-8 w-8 items-center justify-center rounded-xl text-ui-subtle hover:bg-ui-page-alt"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {activeShift ? (
            <form onSubmit={handleCloseShift} className="space-y-5">
              {/* Shift Stats Card */}
              <div className="rounded-2xl border border-ui-border bg-ui-page-alt p-4 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-ui-muted">{isAr ? 'تاريخ الفتح' : 'Opened At'}</span>
                  <span className="font-black text-ui-text">
                    {new Date(activeShift.opened_at).toLocaleTimeString(isAr ? 'ar-EG' : 'en-US', {
                      hour: '2-digit',
                      minute: '2-digit',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-ui-muted">{isAr ? 'رصيد الافتتاح' : 'Opening Amount'}</span>
                  <span className="font-black text-ui-text">
                    {formatCurrency(activeShift.opening_amount, currency, lang)}
                  </span>
                </div>

                {summary && (
                  <>
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-ui-muted">{isAr ? 'صافي مبيعات الوردية' : 'Shift Net Sales'}</span>
                      <span className="font-black text-ui-primary">
                        {formatCurrency(summary.netSales, currency, lang)} ({summary.totalInvoices} {isAr ? 'فاتورة' : 'inv.'})
                      </span>
                    </div>

                    {summary.paymentMethods.length > 0 && (
                      <div className="border-t border-ui-border/40 pt-2">
                        <div className="mb-1 text-[11px] font-black text-ui-subtle flex items-center gap-1">
                          <CreditCard className="h-3 w-3" />
                          {isAr ? 'طرق الدفع المحصلة:' : 'Payment breakdown:'}
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-[11px]">
                          {summary.paymentMethods.map((pm) => (
                            <div key={pm.method} className="flex justify-between bg-ui-surface p-1.5 rounded-lg border border-ui-border">
                              <span className="text-ui-muted truncate">{pm.label.split(' ')[0]}</span>
                              <span className="font-black text-ui-text">{formatCurrency(pm.total, currency, lang)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Products and Ingredients Count Indicators */}
                    <div className="grid grid-cols-2 gap-2 pt-1 text-[11px]">
                      <div className="flex items-center gap-1.5 p-2 rounded-xl bg-ui-surface border border-ui-border">
                        <ShoppingBag className="h-4 w-4 text-ui-accent" />
                        <div>
                          <p className="font-bold text-ui-muted">{isAr ? 'أصناف مباعة' : 'Products sold'}</p>
                          <p className="font-black text-ui-text">{summary.productsSold.length} {isAr ? 'صنف' : 'items'}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 p-2 rounded-xl bg-ui-surface border border-ui-border">
                        <Utensils className="h-4 w-4 text-ui-success" />
                        <div>
                          <p className="font-bold text-ui-muted">{isAr ? 'مكونات مستهلكة' : 'Ingredients'}</p>
                          <p className="font-black text-ui-text">{summary.ingredientsConsumed.length} {isAr ? 'مادة خام' : 'materials'}</p>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                <div className="flex items-center justify-between border-t border-ui-border/60 pt-2 text-sm">
                  <span className="font-black text-ui-text">{isAr ? 'المبلغ المتوقع بالدرج' : 'Expected Cash'}</span>
                  <span className="font-black text-ui-accent">
                    {formatCurrency(expectedAmount, currency, lang)}
                  </span>
                </div>
              </div>

              {/* Actual Cash Input */}
              <div>
                <label className="mb-2 block text-xs font-black text-ui-muted">
                  {isAr ? 'المبلغ الفعلي بالدرج (العد الفعلي) *' : 'Actual Cash in Drawer *'}
                </label>
                <input
                  type="number"
                  min={0}
                  step="any"
                  required
                  value={closingCash}
                  onChange={(e) => setClosingCash(e.target.value === '' ? '' : parseFloat(e.target.value))}
                  placeholder="0.00"
                  className="h-14 w-full rounded-2xl border border-ui-border bg-ui-page-alt text-center text-2xl font-black text-ui-text outline-none focus:border-ui-primary focus:ring-2 focus:ring-ui-ring"
                />
              </div>

              {/* Live Difference Indicator */}
              {typeof closingCash === 'number' && (
                <div
                  className={`flex items-center justify-between rounded-2xl p-4 text-xs font-black ${
                    difference === 0
                      ? 'bg-ui-success/10 text-ui-success'
                      : difference > 0
                      ? 'bg-ui-info/10 text-ui-info'
                      : 'bg-ui-danger/10 text-ui-danger'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    {difference === 0 ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <AlertCircle className="h-4 w-4" />
                    )}
                    <span>
                      {difference === 0
                        ? isAr
                          ? 'الدرج متطابق تماماً'
                          : 'Drawer matches exactly'
                        : difference > 0
                        ? isAr
                          ? 'يوجد زيادة في الدرج'
                          : 'Cash Surplus'
                        : isAr
                        ? 'يوجد عجز في الدرج'
                        : 'Cash Shortage'}
                    </span>
                  </div>
                  <span>{formatCurrency(Math.abs(difference), currency, lang)}</span>
                </div>
              )}

              {/* Print buttons */}
              {summary && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handlePrintThermal}
                    className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-ui-border bg-ui-surface p-2.5 text-xs font-black text-ui-text hover:bg-ui-page-alt transition"
                  >
                    <Printer className="h-4 w-4 text-ui-accent" />
                    {isAr ? 'طباعة إيصال Z-Report' : 'Print Thermal Z-Report'}
                  </button>
                  <button
                    type="button"
                    onClick={handlePrintA4}
                    className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-ui-border bg-ui-surface p-2.5 text-xs font-black text-ui-text hover:bg-ui-page-alt transition"
                  >
                    <FileText className="h-4 w-4 text-ui-primary" />
                    {isAr ? 'تقرير إغلاق A4 كامل' : 'Full A4 Closing Report'}
                  </button>
                </div>
              )}

              {/* Closing Notes */}
              <div>
                <label className="mb-1.5 block text-xs font-black text-ui-muted">
                  {isAr ? 'ملاحظات إغلاق الوردية واليوم' : 'Closing Notes'}
                </label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={isAr ? 'أي ملاحظات أو توضيحات إضافية حول الإغلاق...' : 'Any closing remarks...'}
                  className="w-full rounded-xl border border-ui-border bg-ui-page-alt p-3 text-xs font-bold text-ui-text outline-none focus:border-ui-primary"
                />
              </div>

              {/* Submit Button */}
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 rounded-xl border border-ui-border bg-ui-surface py-3 text-xs font-black text-ui-muted hover:bg-ui-page-alt"
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  disabled={closing || typeof closingCash !== 'number'}
                  className="flex-1 rounded-xl bg-ui-danger py-3 text-xs font-black text-ui-primary-fg shadow-ui-md hover:bg-ui-danger/90 disabled:opacity-50"
                >
                  {closing ? (isAr ? 'جاري الإغلاق...' : 'Closing...') : (isAr ? 'إغلاق اليوم والوردية' : 'Close Day & Shift')}
                </button>
              </div>
            </form>
          ) : (
            <div className="py-8 text-center text-ui-subtle">
              <Timer className="mx-auto mb-3 h-12 w-12 opacity-20" />
              <p className="text-sm font-bold">{isAr ? 'لا توجد وردية مفتوحة حالياً لهذا الفرع' : 'No open shift for this branch'}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

