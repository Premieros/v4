import { useState } from 'react';
import { Search, UserPlus, X, Phone, User, MapPin } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { supabase } from '@/api';
import { useToast } from '@/components/Toast';
import type { Customer } from '@/lib/types';

interface CustomerQuickModalProps {
  isOpen: boolean;
  onClose: () => void;
  customers: Customer[];
  selectedCustomerId: string;
  onSelectCustomer: (customer: Customer) => void;
  onCustomerCreated: (newCustomer: Customer) => void;
  branchId?: string;
}

export function CustomerQuickModal({
  isOpen,
  onClose,
  customers,
  selectedCustomerId,
  onSelectCustomer,
  onCustomerCreated,
}: CustomerQuickModalProps) {
  const { t, lang } = useLanguage();
  const isAr = lang === 'ar';
  const { show } = useToast();

  const [search, setSearch] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const filtered = customers.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      (c.phone && c.phone.includes(q)) ||
      (c.name_en && c.name_en.toLowerCase().includes(q))
    );
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setSubmitting(true);
    try {
      const { data, error } = await supabase
        .from('customers')
        .insert({
          name: name.trim(),
          phone: phone.trim() || null,
          address: address.trim() || null,
          balance: 0,
        })
        .select()
        .single();

      if (error) throw error;

      if (data) {
        show(isAr ? 'تم إنشاء العميل بنجاح' : 'Customer created successfully', 'success');
        onCustomerCreated(data);
        onSelectCustomer(data);
        onClose();
      }
    } catch (err: unknown) {
      show(err instanceof Error ? err.message : 'Error creating customer', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ui-text/50 p-4 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-3xl border border-ui-border bg-ui-surface shadow-ui-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-ui-border px-6 py-4">
          <div className="flex items-center gap-2">
            <User className="h-5 w-5 text-ui-accent" />
            <h3 className="text-base font-black text-ui-text">
              {isCreating ? (isAr ? 'إضافة عميل جديد' : 'New Customer') : (isAr ? 'اختيار العميل' : 'Select Customer')}
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

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {isCreating ? (
            <form onSubmit={handleCreate} className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-black text-ui-muted">
                  {isAr ? 'اسم العميل *' : 'Customer Name *'}
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={isAr ? 'أدخل اسم العميل' : 'Enter customer name'}
                  className="h-11 w-full rounded-xl border border-ui-border bg-ui-page-alt px-3 text-xs font-bold text-ui-text outline-none focus:border-ui-primary"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-black text-ui-muted">
                  {isAr ? 'رقم الهاتف' : 'Phone Number'}
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="01xxxxxxxxx"
                  className="h-11 w-full rounded-xl border border-ui-border bg-ui-page-alt px-3 text-xs font-bold text-ui-text outline-none focus:border-ui-primary"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-black text-ui-muted">
                  {isAr ? 'العنوان' : 'Address'}
                </label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder={isAr ? 'الشارع، المنطقة، رقم الشقة...' : 'Street, district, apt...'}
                  className="h-11 w-full rounded-xl border border-ui-border bg-ui-page-alt px-3 text-xs font-bold text-ui-text outline-none focus:border-ui-primary"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreating(false)}
                  className="flex-1 rounded-xl border border-ui-border bg-ui-surface py-2.5 text-xs font-black text-ui-muted"
                >
                  {isAr ? 'رجوع للبحث' : 'Back to Search'}
                </button>
                <button
                  type="submit"
                  disabled={submitting || !name.trim()}
                  className="flex-1 rounded-xl bg-ui-primary py-2.5 text-xs font-black text-ui-primary-fg shadow-ui-md disabled:opacity-50"
                >
                  {submitting ? (isAr ? 'جاري الحفظ...' : 'Saving...') : (isAr ? 'حفظ واختيار' : 'Save & Select')}
                </button>
              </div>
            </form>
          ) : (
            <>
              {/* Search & Create button */}
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ui-subtle" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={isAr ? 'ابحث بالاسم أو الهاتف...' : 'Search by name or phone...'}
                    className="h-11 w-full rounded-xl border border-ui-border bg-ui-page-alt ps-9 pe-3 text-xs font-bold text-ui-text outline-none focus:border-ui-primary"
                    autoFocus
                  />
                </div>
                <button
                  onClick={() => {
                    setName(search);
                    setIsCreating(true);
                  }}
                  className="flex items-center gap-1.5 rounded-xl bg-ui-primary px-3 text-xs font-black text-ui-primary-fg shadow-ui-sm hover:bg-ui-primary-hover"
                >
                  <UserPlus className="h-4 w-4" />
                  <span className="hidden sm:inline">{isAr ? 'جديد' : 'New'}</span>
                </button>
              </div>

              {/* Customer List */}
              <div className="divide-y divide-ui-border/60 max-h-64 overflow-y-auto">
                {filtered.length === 0 ? (
                  <div className="py-8 text-center text-xs text-ui-subtle">
                    {t('noData')}
                  </div>
                ) : (
                  filtered.map((c) => {
                    const isSelected = c.id === selectedCustomerId;
                    return (
                      <button
                        key={c.id}
                        onClick={() => {
                          onSelectCustomer(c);
                          onClose();
                        }}
                        className={`flex w-full items-center justify-between p-3 text-start transition hover:bg-ui-page-alt ${
                          isSelected ? 'bg-ui-primary-soft' : ''
                        }`}
                      >
                        <div>
                          <p className="text-xs font-black text-ui-text">{c.name}</p>
                          {c.phone && (
                            <p className="flex items-center gap-1 text-[11px] text-ui-subtle">
                              <Phone className="h-3 w-3" />
                              {c.phone}
                            </p>
                          )}
                          {c.address && (
                            <p className="flex items-center gap-1 text-[10px] text-ui-muted truncate max-w-[200px]">
                              <MapPin className="h-2.5 w-2.5" />
                              {c.address}
                            </p>
                          )}
                        </div>
                        {isSelected && (
                          <span className="rounded-lg bg-ui-primary px-2 py-0.5 text-[10px] font-black text-ui-primary-fg">
                            {isAr ? 'محدد' : 'Selected'}
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
