import { useState } from 'react';
import { UtensilsCrossed, X, Users, Check } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import type { DiningArea, DiningTable } from '@/lib/types';

interface TableSelectModalProps {
  isOpen: boolean;
  onClose: () => void;
  tables: DiningTable[];
  areas: DiningArea[];
  selectedTableId: string | null;
  onSelectTable: (table: DiningTable) => void;
}

export function TableSelectModal({
  isOpen,
  onClose,
  tables,
  areas,
  selectedTableId,
  onSelectTable,
}: TableSelectModalProps) {
  const { t, lang } = useLanguage();
  const isAr = lang === 'ar';
  const [selectedAreaId, setSelectedAreaId] = useState<string>('');

  if (!isOpen) return null;

  const filteredTables = tables.filter((table) => {
    if (!table.is_active) return false;
    if (selectedAreaId && table.area_id !== selectedAreaId) return false;
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ui-text/50 p-4 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-ui-border bg-ui-surface shadow-ui-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-ui-border px-6 py-4">
          <div className="flex items-center gap-2">
            <UtensilsCrossed className="h-5 w-5 text-ui-accent" />
            <h3 className="text-base font-black text-ui-text">
              {isAr ? 'اختيار الطاولة' : 'Select Dining Table'}
            </h3>
          </div>
          <button
            onClick={onClose}
            aria-label={isAr ? 'إغلاق' : 'Close'}
            className="flex h-8 w-8 items-center justify-center rounded-xl text-ui-subtle hover:bg-ui-page-alt"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Areas Filter */}
        {areas.length > 0 && (
          <div className="flex gap-2 border-b border-ui-border bg-ui-page-alt px-6 py-3 overflow-x-auto">
            <button
              onClick={() => setSelectedAreaId('')}
              className={`rounded-xl px-4 py-1.5 text-xs font-black transition ${
                !selectedAreaId
                  ? 'bg-ui-primary text-ui-primary-fg shadow-ui-sm'
                  : 'bg-ui-surface text-ui-muted border border-ui-border'
              }`}
            >
              {isAr ? 'كل الصالات' : 'All Areas'}
            </button>
            {areas.map((area) => (
              <button
                key={area.id}
                onClick={() => setSelectedAreaId(area.id)}
                className={`rounded-xl px-4 py-1.5 text-xs font-black transition ${
                  selectedAreaId === area.id
                    ? 'bg-ui-primary text-ui-primary-fg shadow-ui-sm'
                    : 'bg-ui-surface text-ui-muted border border-ui-border'
                }`}
              >
                {area.name}
              </button>
            ))}
          </div>
        )}

        {/* Tables Grid */}
        <div className="flex-1 overflow-y-auto p-6">
          {filteredTables.length === 0 ? (
            <div className="py-12 text-center text-ui-subtle">
              <UtensilsCrossed className="mx-auto mb-2 h-10 w-10 opacity-30" />
              <p className="text-xs font-bold">{t('noData')}</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {filteredTables.map((table) => {
                const isSelected = table.id === selectedTableId;
                const isOccupied = table.status === 'occupied';

                return (
                  <button
                    key={table.id}
                    onClick={() => {
                      onSelectTable(table);
                      onClose();
                    }}
                    className={`flex flex-col items-center justify-center gap-2 rounded-2xl border-2 p-4 text-center transition active:scale-95 ${
                      isSelected
                        ? 'border-ui-primary bg-ui-primary-soft text-ui-accent shadow-ui-md'
                        : isOccupied
                        ? 'border-ui-warning/40 bg-ui-warning/10 text-ui-warning'
                        : 'border-ui-border bg-ui-surface hover:border-ui-primary-hover hover:bg-ui-page-alt text-ui-text'
                    }`}
                  >
                    <div className="flex items-center gap-1">
                      <span className="text-sm font-black">{table.name}</span>
                      {isSelected && <Check className="h-4 w-4 text-ui-accent" />}
                    </div>
                    <div className="flex items-center gap-1 text-[11px] opacity-75">
                      <Users className="h-3 w-3" />
                      <span>{table.capacity} {isAr ? 'أفراد' : 'seats'}</span>
                    </div>
                    <span
                      className={`mt-1 rounded-md px-2 py-0.5 text-[9px] font-black ${
                        isOccupied
                          ? 'bg-ui-warning/20 text-ui-warning'
                          : 'bg-ui-success/20 text-ui-success'
                      }`}
                    >
                      {isOccupied ? (isAr ? 'مشغولة' : 'Occupied') : (isAr ? 'متاحة' : 'Vacant')}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
