import { useMemo } from 'react';
import { Search, X, ShoppingCart, Package, Plus, ScanBarcode, SlidersHorizontal } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { formatCurrency } from '@/lib/format';
import type { Category, Product, ProductComponent } from '@/lib/types';

interface ProductBrowserProps {
  products: Product[];
  categories: Category[];
  stockMap: Record<string, number>;
  sellableStock: Record<string, number>;
  recipeMap: Record<string, ProductComponent[]>;
  search: string;
  selectedCategory: string;
  currency: string;
  hasBranch: boolean;
  onSearch: (value: string) => void;
  onSelectCategory: (id: string) => void;
  onAddToCart: (product: Product) => void;
  onConfigureProduct?: (product: Product) => void;
  inputRef?: React.Ref<HTMLInputElement>;
}

export function ProductBrowser({ products, categories, stockMap, sellableStock, recipeMap, search, selectedCategory, currency, hasBranch, onSearch, onSelectCategory, onAddToCart, onConfigureProduct, inputRef }: ProductBrowserProps) {
  const { t, lang } = useLanguage();
  const isAr = lang === 'ar';
  const filteredProducts = useMemo(() => products.filter((p) => (!selectedCategory || p.category_id === selectedCategory) && (!search || [p.name, p.name_en, p.barcode, p.sku].some((v) => v?.toLowerCase().includes(search.toLowerCase())))), [products, search, selectedCategory]);
  const counts = useMemo(() => products.reduce<Record<string, number>>((a, p) => { const k = p.category_id || '_none'; a[k] = (a[k] || 0) + 1; return a; }, {}), [products]);

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-ui-page">
      <div className="sticky top-0 z-10 border-b border-ui-border bg-ui-surface/95 px-4 py-3 backdrop-blur">
        <div className="flex gap-3">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ui-subtle" />
            <input ref={inputRef} value={search} onChange={(e) => onSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { const p = products.find((x) => x.barcode === search); if (p) { onAddToCart(p); onSearch(''); } } }} placeholder={isAr ? 'ابحث عن منتج أو امسح الباركود (F2)...' : 'Search or scan barcode (F2)...'} className="h-12 w-full rounded-2xl border border-ui-border bg-ui-page-alt ps-12 pe-10 text-sm font-bold text-ui-text outline-none transition focus:border-ui-primary focus:ring-2 focus:ring-ui-ring" autoComplete="off" />
            {search && <button onClick={() => onSearch('')} className="absolute end-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-ui-subtle hover:bg-ui-page-alt"><X className="h-4 w-4" /></button>}
            {!search && <ScanBarcode className="absolute end-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ui-subtle" />}
          </div>
          <div className="hidden min-w-16 items-center justify-center rounded-2xl border border-ui-border bg-ui-page-alt px-3 text-sm font-black text-ui-muted sm:flex">{filteredProducts.length}</div>
        </div>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-0.5 scrollbar-none">
          <button onClick={() => onSelectCategory('')} className={`min-h-10 shrink-0 rounded-xl px-4 text-xs font-black transition ${!selectedCategory ? 'bg-ui-primary text-ui-primary-fg shadow-ui-lg' : 'border border-ui-border bg-ui-surface text-ui-muted hover:text-ui-text'}`}>{t('allCategories')} <span className="ms-1 opacity-60">{products.length}</span></button>
          {categories.map((c) => <button key={c.id} onClick={() => onSelectCategory(selectedCategory === c.id ? '' : c.id)} className={`min-h-10 shrink-0 rounded-xl px-4 text-xs font-black transition ${selectedCategory === c.id ? 'bg-ui-primary text-ui-primary-fg shadow-ui-lg' : 'border border-ui-border bg-ui-surface text-ui-muted hover:text-ui-text'}`}>{isAr ? c.name : c.name_en || c.name} <span className="ms-1 opacity-50">{counts[c.id] || 0}</span></button>)}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {!hasBranch ? <div className="flex h-full flex-col items-center justify-center text-center text-ui-subtle"><ShoppingCart className="mb-4 h-12 w-12 opacity-20" /><p className="font-black">{isAr ? 'اختر الفرع أولاً' : 'Select a branch first'}</p></div> : filteredProducts.length === 0 ? <div className="flex h-full flex-col items-center justify-center text-center text-ui-subtle"><Package className="mb-4 h-12 w-12 opacity-20" /><p className="font-black">{t('noData')}</p></div> : <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {filteredProducts.map((p) => {
            const manufactured = p.product_type === 'manufactured';
            const noRecipe = manufactured && !recipeMap[p.id]?.length;
            const stock = manufactured ? sellableStock[p.id] || 0 : stockMap[p.id] || 0;
            const unavailable = stock <= 0 || noRecipe;
            const productLabel = isAr ? p.name : p.name_en || p.name;
            return <div key={p.id} className={`group relative flex min-h-44 flex-col overflow-hidden rounded-2xl border bg-ui-surface text-start shadow-ui-sm transition ${unavailable ? 'cursor-not-allowed opacity-45 border-ui-border' : 'border-ui-border hover:-translate-y-1 hover:border-ui-primary hover:shadow-ui-lg'}`}>
              <div onClick={() => !unavailable && onAddToCart(p)} className="relative h-28 cursor-pointer overflow-hidden bg-ui-page-alt">
                {p.image_url ? <img src={p.image_url} alt={p.name} className="h-full w-full object-cover transition duration-300 group-hover:scale-105" /> : <div className="flex h-full items-center justify-center"><ShoppingCart className="h-9 w-9 text-ui-subtle" /></div>}
                <span className={`absolute end-2 top-2 rounded-lg px-2 py-1 text-[10px] font-black text-ui-primary-fg ${noRecipe ? 'bg-ui-danger/90' : unavailable ? 'bg-ui-danger/90' : stock <= (p.low_stock_threshold || 5) ? 'bg-ui-warning/90' : 'bg-ui-success/90'}`}>{noRecipe ? t('noRecipe') : unavailable ? (isAr ? 'غير متاح' : 'Unavailable') : stock}</span>
              </div>
              <div className="flex flex-1 flex-col p-3">
                <p onClick={() => !unavailable && onAddToCart(p)} className="cursor-pointer truncate text-sm font-black text-ui-text hover:text-ui-accent">{productLabel}</p>
                <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                  <span className="text-base font-black text-ui-accent">{formatCurrency(p.sale_price, currency, lang)}</span>
                  {!unavailable && <div className="flex items-center gap-1">
                    {onConfigureProduct && <button type="button" onClick={(e) => { e.stopPropagation(); onConfigureProduct(p); }} title={isAr ? 'تخصيص الصنف' : 'Configure Item'} aria-label={isAr ? 'تخصيص الصنف' : 'Configure Item'} className="flex h-8 w-8 items-center justify-center rounded-xl border border-ui-border bg-ui-page-alt text-ui-muted hover:border-ui-primary hover:text-ui-accent transition"><SlidersHorizontal className="h-3.5 w-3.5" /></button>}
                    <button type="button" aria-label={productLabel} title={isAr ? `إضافة ${productLabel}` : `Add ${productLabel}`} onClick={() => onAddToCart(p)} className="flex h-8 w-8 items-center justify-center rounded-xl bg-ui-accent text-ui-primary-fg shadow-ui-sm hover:bg-ui-accent/90 active:scale-95 transition"><Plus className="h-4 w-4" /></button>
                  </div>}
                </div>
              </div>
            </div>;
          })}
        </div>}
      </div>
    </section>
  );
}
