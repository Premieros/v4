import { useState } from 'react';
import { Minus, Plus, X, Check, Tag } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { formatCurrency } from '@/lib/format';
import type { CartItem, Product } from '@/lib/types';

interface ProductConfigModalProps {
  product: Product | null;
  initialItem?: CartItem | null;
  currency: string;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (item: CartItem) => void;
  canDiscount?: boolean;
}

const COMMON_MODIFIERS = [
  { id: 'no_onion', nameAr: 'بدون بصل', nameEn: 'No Onion', price: 0 },
  { id: 'extra_sauce', nameAr: 'صلصة إضافية', nameEn: 'Extra Sauce', price: 5 },
  { id: 'spicy', nameAr: 'حار (سبايسي)', nameEn: 'Spicy', price: 0 },
  { id: 'extra_cheese', nameAr: 'جبنة إضافية', nameEn: 'Extra Cheese', price: 10 },
  { id: 'less_salt', nameAr: 'ملح قليل', nameEn: 'Less Salt', price: 0 },
  { id: 'well_done', nameAr: 'مستوي جيداً', nameEn: 'Well Done', price: 0 },
];

export function ProductConfigModal({
  product,
  initialItem,
  currency,
  isOpen,
  onClose,
  onConfirm,
  canDiscount = true,
}: ProductConfigModalProps) {
  const { t, lang } = useLanguage();
  const isAr = lang === 'ar';

  const [quantity, setQuantity] = useState(() => initialItem?.quantity || 1);
  const [selectedModifiers, setSelectedModifiers] = useState<string[]>(() => {
    return initialItem?.modifiers?.map((m) => m.name) || [];
  });
  const [itemNotes, setItemNotes] = useState(() => initialItem?.modifiers?.find(m => m.name.startsWith('note:'))?.name.replace('note:', '') || '');
  const [itemDiscount, setItemDiscount] = useState(() => initialItem?.discount_amount || 0);

  if (!isOpen || !product) return null;

  const toggleModifier = (name: string) => {
    setSelectedModifiers((prev) =>
      prev.includes(name) ? prev.filter((m) => m !== name) : [...prev, name]
    );
  };

  const basePrice = product.sale_price || 0;
  const modifierExtra = selectedModifiers.reduce((acc, modName) => {
    const found = COMMON_MODIFIERS.find((m) => (isAr ? m.nameAr : m.nameEn) === modName);
    return acc + (found?.price || 0);
  }, 0);

  const unitPrice = basePrice + modifierExtra;
  const lineSubtotal = unitPrice * quantity;
  const lineTotal = Math.max(0, lineSubtotal - itemDiscount);

  const handleSave = () => {
    const modifiersList: { name: string }[] = selectedModifiers.map((m) => ({ name: m }));
    if (itemNotes.trim()) {
      modifiersList.push({ name: `note:${itemNotes.trim()}` });
    }

    onConfirm({
      product,
      unit_name: initialItem?.unit_name || 'piece',
      quantity,
      unit_price: unitPrice,
      discount_amount: itemDiscount,
      bonus_quantity: 0,
      modifiers: modifiersList,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ui-text/50 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-ui-border bg-ui-surface shadow-ui-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-ui-border px-6 py-4">
          <div className="flex items-center gap-3">
            {product.image_url ? (
              <img
                src={product.image_url}
                alt={product.name}
                className="h-12 w-12 rounded-2xl object-cover"
              />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ui-primary-soft text-ui-accent">
                <Tag className="h-6 w-6" />
              </div>
            )}
            <div>
              <h3 className="text-base font-black text-ui-text">
                {isAr ? product.name : product.name_en || product.name}
              </h3>
              <p className="text-xs font-bold text-ui-accent">
                {formatCurrency(product.sale_price, currency, lang)}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label={isAr ? 'إغلاق' : 'Close'}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-ui-subtle hover:bg-ui-page-alt hover:text-ui-text"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Quantity Selector */}
          <div>
            <label className="mb-2 block text-xs font-black text-ui-muted">
              {isAr ? 'الكمية' : 'Quantity'}
            </label>
            <div className="flex items-center justify-center gap-4 rounded-2xl border border-ui-border bg-ui-page-alt p-3">
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                aria-label={isAr ? 'تقليل' : 'Decrease'}
                className="flex h-11 w-11 items-center justify-center rounded-xl border border-ui-border bg-ui-surface text-ui-text shadow-ui-sm active:scale-95"
              >
                <Minus className="h-5 w-5" />
              </button>
              <span className="w-16 text-center text-2xl font-black text-ui-text">
                {quantity}
              </span>
              <button
                type="button"
                onClick={() => setQuantity((q) => q + 1)}
                aria-label={isAr ? 'زيادة' : 'Increase'}
                className="flex h-11 w-11 items-center justify-center rounded-xl bg-ui-accent text-ui-primary-fg shadow-ui-sm active:scale-95"
              >
                <Plus className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Modifiers / Add-ons */}
          <div>
            <label className="mb-2 block text-xs font-black text-ui-muted">
              {isAr ? 'الإضافات والتعديلات' : 'Modifiers & Extras'}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {COMMON_MODIFIERS.map((mod) => {
                const label = isAr ? mod.nameAr : mod.nameEn;
                const active = selectedModifiers.includes(label);
                return (
                  <button
                    key={mod.id}
                    type="button"
                    onClick={() => toggleModifier(label)}
                    className={`flex items-center justify-between rounded-xl border p-3 text-xs font-bold transition ${
                      active
                        ? 'border-ui-primary bg-ui-primary-soft text-ui-accent shadow-ui-sm'
                        : 'border-ui-border bg-ui-page-alt text-ui-muted hover:bg-ui-surface'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      {active && <Check className="h-3.5 w-3.5 text-ui-accent" />}
                      {label}
                    </span>
                    {mod.price > 0 && (
                      <span className="text-[10px] font-black opacity-80">
                        +{formatCurrency(mod.price, currency, lang)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Special Notes / Instructions */}
          <div>
            <label className="mb-2 block text-xs font-black text-ui-muted">
              {isAr ? 'ملاحظات خاصة للصنف' : 'Item Notes / Special Instructions'}
            </label>
            <input
              type="text"
              value={itemNotes}
              onChange={(e) => setItemNotes(e.target.value)}
              placeholder={isAr ? 'مثال: بدون ثوم، تسوية خفيفة...' : 'e.g., Extra hot, light salt...'}
              className="h-11 w-full rounded-xl border border-ui-border bg-ui-page-alt px-4 text-xs font-bold text-ui-text outline-none focus:border-ui-primary focus:ring-2 focus:ring-ui-ring"
            />
          </div>

          {/* Line Item Discount (if allowed) */}
          {canDiscount && (
            <div>
              <label className="mb-2 block text-xs font-black text-ui-muted">
                {isAr ? 'خصم على الصنف' : 'Item Discount'} ({currency})
              </label>
              <input
                type="number"
                min={0}
                max={lineSubtotal}
                value={itemDiscount || ''}
                onChange={(e) => setItemDiscount(parseFloat(e.target.value) || 0)}
                placeholder="0"
                className="h-11 w-full rounded-xl border border-ui-border bg-ui-page-alt px-4 text-xs font-bold text-ui-text outline-none focus:border-ui-primary focus:ring-2 focus:ring-ui-ring"
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-ui-border bg-ui-page-alt px-6 py-4">
          <div>
            <p className="text-[11px] font-bold text-ui-subtle">{isAr ? 'إجمالي الصنف' : 'Line Total'}</p>
            <p className="text-xl font-black text-ui-accent">
              {formatCurrency(lineTotal, currency, lang)}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-ui-border bg-ui-surface px-5 py-2.5 text-xs font-black text-ui-muted hover:bg-ui-page-alt"
            >
              {t('cancel')}
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="rounded-xl bg-ui-primary px-6 py-2.5 text-xs font-black text-ui-primary-fg shadow-ui-md hover:bg-ui-primary-hover"
            >
              {initialItem ? (isAr ? 'تحديث الصنف' : 'Update Item') : (isAr ? 'إضافة للطلب' : 'Add to Order')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
