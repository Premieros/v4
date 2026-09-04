import { useState, useMemo } from 'react';
import { ArrowRightLeft, AlertTriangle, Users } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import type { DiningArea, DiningTable, Order } from '@/lib/types';

interface TransferOrderModalProps {
  open: boolean;
  onClose: () => void;
  order: Order | null;
  sourceTable: DiningTable | null;
  tables: DiningTable[];
  areas?: DiningArea[];
  ordersByTable: Record<string, Order[]>;
  onConfirmTransfer: (orderId: string, fromTableId: string, toTableId: string) => Promise<boolean>;
}

export function TransferOrderModal({
  open,
  onClose,
  order,
  sourceTable,
  tables,
  areas = [],
  ordersByTable,
  onConfirmTransfer,
}: TransferOrderModalProps) {
  const { t, lang } = useLanguage();
  const isAr = lang === 'ar';

  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [activeAreaFilter, setActiveAreaFilter] = useState<'all' | 'indoor' | 'outdoor'>('all');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Categorize tables into Indoor and Outdoor
  const availableTargetTables = useMemo(() => {
    return tables.filter((tb) => tb.id !== sourceTable?.id);
  }, [tables, sourceTable]);

  const filteredTables = useMemo(() => {
    return availableTargetTables.filter((tb) => {
      if (activeAreaFilter === 'all') return true;
      const areaName = areas.find((a) => a.id === tb.area_id)?.name?.toLowerCase() || '';
      const tableName = tb.name.toLowerCase();
      
      const isOutdoor =
        areaName.includes('outdoor') ||
        areaName.includes('خارج') ||
        areaName.includes('تراس') ||
        areaName.includes('terrace') ||
        areaName.includes('patio') ||
        tableName.includes('outdoor') ||
        tableName.includes('خارج');

      if (activeAreaFilter === 'outdoor') return isOutdoor;
      if (activeAreaFilter === 'indoor') return !isOutdoor;
      return true;
    });
  }, [availableTargetTables, activeAreaFilter, areas]);

  const selectedTargetTable = useMemo(() => {
    return tables.find((tb) => tb.id === selectedTargetId) || null;
  }, [tables, selectedTargetId]);

  const targetHasOrder = selectedTargetTable ? (ordersByTable[selectedTargetTable.id]?.length || 0) > 0 : false;

  const handleExecuteTransfer = async () => {
    if (!order || !sourceTable || !selectedTargetId) return;

    if (targetHasOrder) {
      setErrorMsg(
        isAr
          ? 'الطاولة المختارة مشغولة بطلب آخر بالفعل. يرجى اختيار طاولة متاحة فارغة.'
          : 'Selected table already has an active order. Please choose an available table.'
      );
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    try {
      const ok = await onConfirmTransfer(order.id, sourceTable.id, selectedTargetId);
      if (ok) {
        onClose();
        setSelectedTargetId(null);
      } else {
        setErrorMsg(isAr ? 'فشل نقل الطلب، يرجى المحاولة ثانية' : 'Failed to transfer order');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Transfer failed');
    } finally {
      setLoading(false);
    }
  };

  if (!open || !order || !sourceTable) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isAr ? 'تحويل ونقل الطلب بين الطاولات' : 'Transfer Order to Another Table'}
      size="lg"
    >
      <div className="space-y-4">
        {/* Info Banner */}
        <div className="rounded-2xl border border-ui-border bg-ui-page p-3.5 flex items-center justify-between">
          <div>
            <p className="text-xs text-ui-subtle">{isAr ? 'الطلب الحالي' : 'Active Order'}</p>
            <p className="text-sm font-black text-ui-text">
              #{order.order_number} · {isAr ? `طاولة (${sourceTable.name})` : `Table (${sourceTable.name})`}
            </p>
          </div>
          <div className="text-end">
            <span className="inline-flex items-center rounded-lg bg-ui-primary-soft text-ui-accent px-2.5 py-1 text-xs font-black">
              {isAr ? 'احتفاظ ببيانات الطلب والمطبخ' : 'Preserve Order & KDS'}
            </span>
          </div>
        </div>

        {/* Indoor / Outdoor Tabs */}
        <div className="flex items-center gap-1 rounded-xl bg-ui-page-alt p-1">
          <button
            type="button"
            onClick={() => setActiveAreaFilter('all')}
            className={`flex-1 rounded-lg py-1.5 text-xs font-black transition ${
              activeAreaFilter === 'all'
                ? 'bg-ui-surface text-ui-text shadow-ui-xs'
                : 'text-ui-muted hover:text-ui-text'
            }`}
          >
            {isAr ? 'جميع الطاولات' : 'All Tables'} ({availableTargetTables.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveAreaFilter('indoor')}
            className={`flex-1 rounded-lg py-1.5 text-xs font-black transition ${
              activeAreaFilter === 'indoor'
                ? 'bg-ui-surface text-ui-text shadow-ui-xs'
                : 'text-ui-muted hover:text-ui-text'
            }`}
          >
            {isAr ? 'الصالة الداخلية (Indoor)' : 'Indoor Area'}
          </button>
          <button
            type="button"
            onClick={() => setActiveAreaFilter('outdoor')}
            className={`flex-1 rounded-lg py-1.5 text-xs font-black transition ${
              activeAreaFilter === 'outdoor'
                ? 'bg-ui-surface text-ui-text shadow-ui-xs'
                : 'text-ui-muted hover:text-ui-text'
            }`}
          >
            {isAr ? 'الصالة الخارجية (Outdoor / Terrace)' : 'Outdoor / Terrace'}
          </button>
        </div>

        {/* Tables Grid Selection */}
        <div className="max-h-[300px] overflow-y-auto space-y-2 pr-1">
          <p className="text-xs font-bold text-ui-subtle">
            {isAr ? 'اختر الطاولة المراد نقل الطلب إليها:' : 'Select destination table:'}
          </p>
          
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
            {filteredTables.map((tb) => {
              const hasOrd = (ordersByTable[tb.id]?.length || 0) > 0;
              const isSelected = selectedTargetId === tb.id;
              return (
                <button
                  key={tb.id}
                  type="button"
                  onClick={() => {
                    setSelectedTargetId(tb.id);
                    setErrorMsg(null);
                  }}
                  className={`flex flex-col items-start justify-between rounded-xl border p-2.5 text-start transition ${
                    isSelected
                      ? 'border-ui-primary bg-ui-primary-soft ring-2 ring-ui-primary'
                      : hasOrd
                      ? 'border-amber-500/30 bg-amber-500/5 hover:border-amber-500/60'
                      : 'border-ui-border bg-ui-surface hover:border-emerald-500 hover:bg-emerald-500/5'
                  }`}
                >
                  <div className="flex w-full items-center justify-between">
                    <span className="text-sm font-black text-ui-text">{tb.name}</span>
                    <span className="flex items-center gap-0.5 text-[10px] text-ui-muted">
                      <Users className="h-2.5 w-2.5" /> {tb.capacity}
                    </span>
                  </div>

                  <div className="mt-2 w-full">
                    {hasOrd ? (
                      <span className="block text-[10px] font-bold text-amber-600 bg-amber-500/10 px-1.5 py-0.5 rounded text-center">
                        {isAr ? 'مشغولة بطلب' : 'Occupied'}
                      </span>
                    ) : (
                      <span className="block text-[10px] font-bold text-emerald-600 bg-emerald-500/10 px-1.5 py-0.5 rounded text-center">
                        {isAr ? 'متاحة فارغة' : 'Vacant'}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {filteredTables.length === 0 && (
            <div className="py-8 text-center text-xs font-semibold text-ui-muted">
              {isAr ? 'لا توجد طاولات أخرى مطابقة للتصفية' : 'No other tables found'}
            </div>
          )}
        </div>

        {/* Error message */}
        {errorMsg && (
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs font-bold text-rose-600 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Selected target table confirmation note */}
        {selectedTargetTable && !targetHasOrder && (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs font-semibold text-emerald-700">
            {isAr
              ? `سيتم نقل الطلب #${order.order_number} من طاولة "${sourceTable.name}" إلى طاولة "${selectedTargetTable.name}" فوراً، وستصبح طاولة "${sourceTable.name}" متاحة لاستقبال زبائن جدد.`
              : `Order #${order.order_number} will be transferred from "${sourceTable.name}" to "${selectedTargetTable.name}". Table "${sourceTable.name}" will become vacant.`}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-ui-border">
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            {t('cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={handleExecuteTransfer}
            disabled={loading || !selectedTargetId || targetHasOrder}
          >
            <ArrowRightLeft className="h-4 w-4" />
            <span>{isAr ? 'تأكيد نقل الطلب' : 'Confirm Transfer'}</span>
          </Button>
        </div>
      </div>
    </Modal>
  );
}
