import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Boxes,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Search,
  ChefHat,
  Utensils,
  X,
} from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import {
  type RawMaterialStockInfo,
  type RecipeWithItems,
  fetchBranchRawMaterialsStock,
  fetchBranchRecipes,
  computeManufacturedSellableStock,
} from '@/features/pos/services/kitchenInventory';

interface Props {
  open?: boolean;
  branchId: string;
  branchName?: string;
  currency?: string;
  onClose?: () => void;
}

export function RawAndManufacturedMaterialsPanel({
  open = true,
  branchId,
  branchName,
  onClose,
}: Props) {
  const { lang } = useLanguage();
  const isAr = lang === 'ar';

  const [tab, setTab] = useState<'raw' | 'manufactured'>('raw');
  const [loading, setLoading] = useState(true);
  const [materials, setMaterials] = useState<RawMaterialStockInfo[]>([]);
  const [recipes, setRecipes] = useState<RecipeWithItems[]>([]);
  const [search, setSearch] = useState('');

  const loadData = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    try {
      const [mats, recs] = await Promise.all([
        fetchBranchRawMaterialsStock(branchId),
        fetchBranchRecipes(branchId),
      ]);
      setMaterials(mats);
      setRecipes(recs);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    if (open) {
      void loadData();
    }
  }, [open, loadData]);

  const portionsMap = useMemo(() => {
    return computeManufacturedSellableStock(recipes, materials);
  }, [recipes, materials]);

  const filteredMaterials = useMemo(() => {
    return materials.filter((m) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return m.name.toLowerCase().includes(q) || m.code.toLowerCase().includes(q) || m.category.toLowerCase().includes(q);
    });
  }, [materials, search]);

  const filteredRecipes = useMemo(() => {
    return recipes.filter((r) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (r.product_name || '').toLowerCase().includes(q);
    });
  }, [recipes, search]);

  const lowStockCount = materials.filter((m) => m.status === 'low' || m.status === 'out_of_stock').length;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div
        dir={isAr ? 'rtl' : 'ltr'}
        className="flex flex-col w-full max-w-5xl h-[85vh] bg-ui-surface border border-ui-border rounded-3xl shadow-2xl overflow-hidden animate-scale-in"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-ui-border bg-ui-page-alt/60">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-ui-primary/10 text-ui-primary">
              <Boxes className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-black text-ui-text">
                  {isAr ? 'رصد الخامات ومكونات المنتجات المصنعة' : 'Raw Materials & Recipe Ingredients Monitor'}
                </h2>
                {branchName && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-ui-page text-ui-muted border border-ui-border">
                    {branchName}
                  </span>
                )}
              </div>
              <p className="text-xs text-ui-subtle">
                {isAr
                  ? 'تتبع المخزون اللحظي للمواد الخام وكميات الأطباق المتاحة للتحضير'
                  : 'Real-time inventory of raw ingredients and sellable prepared portions'}
              </p>
            </div>
          </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadData}
            disabled={loading}
            className="p-2 rounded-xl border border-ui-border bg-ui-surface hover:bg-ui-page-alt text-ui-muted hover:text-ui-text transition-colors"
            title={isAr ? 'تحديث البيانات' : 'Refresh'}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-ui-muted hover:bg-ui-page-alt transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Tabs & Search */}
      <div className="p-4 border-b border-ui-border bg-ui-surface flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setTab('raw')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              tab === 'raw'
                ? 'bg-ui-primary text-ui-primary-fg shadow-sm'
                : 'bg-ui-page-alt text-ui-muted hover:text-ui-text'
            }`}
          >
            <Boxes className="w-4 h-4" />
            <span>{isAr ? `الخامات الأولية (${materials.length})` : `Raw Materials (${materials.length})`}</span>
            {lowStockCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-black bg-amber-500 text-white">
                {lowStockCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setTab('manufactured')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              tab === 'manufactured'
                ? 'bg-ui-primary text-ui-primary-fg shadow-sm'
                : 'bg-ui-page-alt text-ui-muted hover:text-ui-text'
            }`}
          >
            <ChefHat className="w-4 h-4" />
            <span>{isAr ? `المنتجات المصنعة والوصفات (${recipes.length})` : `Manufactured Recipes (${recipes.length})`}</span>
          </button>
        </div>

        <div className="relative w-full sm:w-60">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ui-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={isAr ? 'بحث في المواد والخامات...' : 'Search ingredients...'}
            className="w-full ps-8 pe-3 py-1.5 text-xs rounded-xl border border-ui-border bg-ui-page text-ui-text focus:outline-none focus:border-ui-primary"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-5">
        {tab === 'raw' ? (
          <div className="space-y-3">
            {filteredMaterials.length === 0 ? (
              <div className="py-12 text-center text-ui-muted text-sm">
                {isAr ? 'لا توجد خامات مسجلة لهذا الفرع' : 'No raw materials found'}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredMaterials.map((mat) => {
                  return (
                    <div
                      key={mat.raw_material_id}
                      className="p-4 rounded-xl border border-ui-border bg-ui-page space-y-2.5 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h4 className="text-sm font-black text-ui-text">{mat.name}</h4>
                          <span className="text-[11px] text-ui-subtle font-mono">{mat.code}</span>
                        </div>
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-black border ${
                            mat.status === 'out_of_stock'
                              ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300 border-rose-200'
                              : mat.status === 'low'
                              ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 border-amber-200'
                              : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 border-emerald-200'
                          }`}
                        >
                          {mat.status === 'out_of_stock' ? (
                            <>
                              <XCircle className="w-3 h-3" />
                              {isAr ? 'نفذت الكمية' : 'Out of stock'}
                            </>
                          ) : mat.status === 'low' ? (
                            <>
                              <AlertTriangle className="w-3 h-3" />
                              {isAr ? 'مخزون منخفض' : 'Low stock'}
                            </>
                          ) : (
                            <>
                              <CheckCircle2 className="w-3 h-3" />
                              {isAr ? 'متوفر' : 'In stock'}
                            </>
                          )}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-ui-border text-xs">
                        <div>
                          <span className="text-ui-subtle block text-[10px]">{isAr ? 'الرصيد الحالي' : 'Current Stock'}</span>
                          <span className="text-base font-black text-ui-text">
                            {mat.current_stock.toLocaleString(lang)}
                          </span>
                        </div>
                        <div>
                          <span className="text-ui-subtle block text-[10px]">{isAr ? 'حد الطلب الأدنى' : 'Min Stock'}</span>
                          <span className="text-xs font-bold text-ui-muted">
                            {mat.min_stock.toLocaleString(lang)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {filteredRecipes.length === 0 ? (
              <div className="py-12 text-center text-ui-muted text-sm">
                {isAr ? 'لا توجد وصفات مسجلة للمنتجات المصنعة' : 'No recipes found'}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredRecipes.map((r) => {
                  const info = portionsMap[r.product_id] || { portions: 0 };
                  const isAvailable = info.portions > 0;

                  return (
                    <div
                      key={r.recipe_id}
                      className="p-4 rounded-xl border border-ui-border bg-ui-page space-y-3 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h4 className="text-sm font-black text-ui-text flex items-center gap-1.5">
                            <Utensils className="w-4 h-4 text-ui-primary" />
                            <span>{r.product_name || (isAr ? 'منتج مصنع' : 'Manufactured Product')}</span>
                          </h4>
                          <span className="text-xs text-ui-subtle mt-0.5 block">
                            {isAr ? `مكون من ${r.items.length} خامات` : `${r.items.length} ingredients`}
                          </span>
                        </div>

                        <div className="text-end">
                          <span className="text-[10px] text-ui-subtle block">
                            {isAr ? 'كمية قابلة للبيع' : 'Available portions'}
                          </span>
                          <span
                            className={`text-lg font-black ${
                              isAvailable ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600'
                            }`}
                          >
                            {info.portions} {isAr ? 'وجبة / طبق' : 'portions'}
                          </span>
                        </div>
                      </div>

                      {/* Ingredients List */}
                      <div className="space-y-1.5 pt-2 border-t border-ui-border">
                        <span className="text-[11px] font-bold text-ui-subtle block">
                          {isAr ? 'المكونات ونسب الاستهلاك لكل وجبة:' : 'Recipe items per portion:'}
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {r.items.map((it, idx) => (
                            <span
                              key={idx}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs bg-ui-surface border border-ui-border text-ui-text"
                            >
                              <span>{it.raw_material_name}:</span>
                              <strong className="text-ui-primary font-mono">{it.quantity}</strong>
                              {it.wastage_percent > 0 && (
                                <span className="text-[10px] text-ui-subtle">
                                  (+{it.wastage_percent}% هالك)
                                </span>
                              )}
                            </span>
                          ))}
                        </div>
                      </div>

                      {info.limitingIngredient && info.portions <= 5 && (
                        <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 text-xs text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                          <span>
                            {isAr
                              ? `الخامة المحددة للكمية: ${info.limitingIngredient}`
                              : `Bottleneck: ${info.limitingIngredient}`}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  </div>
  );
}
