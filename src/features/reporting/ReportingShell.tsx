import { useState, useMemo, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, LayoutDashboard, TrendingUp, ShoppingCart, Package, Factory, Users, Clock, Wallet, Landmark, BarChart3, FileText, Star, Clock3, ChevronLeft, ChevronRight } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { PageHeader } from '@/components/PageHeader';
import { ReportCard } from './ReportCard';
import {
  REPORT_REGISTRY,
  REPORT_CATEGORIES,
  type ReportCategory,
  type ReportDefinition,
} from './reportRegistry';
import type { ReportType } from './reportFilters';

const CATEGORY_ICONS: Record<ReportCategory, React.ComponentType<{ className?: string }>> = {
  overview: LayoutDashboard,
  sales: TrendingUp,
  purchases_expenses: ShoppingCart,
  inventory: Package,
  manufacturing_costing: Factory,
  customers_suppliers: Users,
  employees_shifts: Clock,
  treasury_payments: Wallet,
  financial: Landmark,
  analytics: BarChart3,
  audit: FileText,
};

const FAVORITES_KEY = 'premire_report_favorites';
const RECENT_KEY = 'premire_report_recent';

function loadFavorites(): string[] {
  try { return JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]'); } catch { return []; }
}
function saveFavorites(favs: string[]) { localStorage.setItem(FAVORITES_KEY, JSON.stringify(favs)); }
function loadRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
}
function saveRecent(recent: string[]) { localStorage.setItem(RECENT_KEY, JSON.stringify(recent)); }

interface ReportingShellProps {
  activeReport: ReportType;
  onSelectReport: (type: ReportType) => void;
  children: React.ReactNode;
}

export function ReportingShell({ activeReport, onSelectReport, children }: ReportingShellProps) {
  const { lang } = useLanguage();
  const [searchParams] = useSearchParams();

  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<ReportCategory | null>(null);
  const [favorites, setFavorites] = useState<string[]>(() => loadFavorites());
  const [recent, setRecent] = useState<string[]>(() => loadRecent());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Record recent when report changes
  useEffect(() => {
    setRecent((prev) => {
      const next = [activeReport, ...prev.filter((r) => r !== activeReport)].slice(0, 6);
      saveRecent(next);
      return next;
    });
  }, [activeReport]);

  // Handle deep links: /reports?type=sales or /reports?reportType=sales
  useEffect(() => {
    const deepType = searchParams.get('type') || searchParams.get('reportType');
    if (deepType && REPORT_REGISTRY.some((r) => r.key === deepType)) {
      onSelectReport(deepType as ReportType);
    }
  }, [searchParams, onSelectReport]);

  const toggleFavorite = useCallback((key: string) => {
    setFavorites((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      saveFavorites(next);
      return next;
    });
  }, []);

  const visibleReports = useMemo(() => {
    let reports = REPORT_REGISTRY;

    if (activeCategory) {
      reports = reports.filter((r) => r.category === activeCategory);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      reports = reports.filter((r) =>
        r.title.toLowerCase().includes(q) ||
        r.titleEn.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.descriptionEn.toLowerCase().includes(q) ||
        r.key.toLowerCase().includes(q)
      );
    }

    return reports;
  }, [activeCategory, searchQuery]);

  const favoriteReports = useMemo(
    () => REPORT_REGISTRY.filter((r) => favorites.includes(r.key)),
    [favorites]
  );

  const recentReports = useMemo(
    () => recent.map((k) => REPORT_REGISTRY.find((r) => r.key === k)).filter(Boolean) as ReportDefinition[],
    [recent]
  );

  const sortedCategories = useMemo(
    () => Object.entries(REPORT_CATEGORIES).sort(([, a], [, b]) => a.order - b.order),
    []
  );

  const reportCountByCategory = useMemo(() => {
    const map: Record<string, number> = {};
    REPORT_REGISTRY.forEach((r) => { map[r.category] = (map[r.category] || 0) + 1; });
    return map;
  }, []);

  return (
    <div>
      <PageHeader
        title={lang === 'ar' ? 'مركز التقارير' : 'Reports Center'}
        subtitle={lang === 'ar' ? 'تصفح واكتشف جميع التقارير' : 'Browse and discover all reports'}
      />

      <div className="flex gap-5 items-start">
        {/* Categories sidebar */}
        <aside className={`flex-shrink-0 transition-all duration-200 ${sidebarCollapsed ? 'w-12' : 'w-56'}`}>
          <div className="bg-ui-surface rounded-xl border border-ui-border shadow-ui sticky top-4 overflow-hidden">
            <button
              onClick={() => setSidebarCollapsed((p) => !p)}
              className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-semibold text-ui-muted border-b border-ui-border hover:bg-ui-page-alt transition-colors"
            >
              {!sidebarCollapsed && (lang === 'ar' ? 'الأقسام' : 'Categories')}
              {sidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
            <nav className="p-1.5">
              <button
                onClick={() => setActiveCategory(null)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeCategory === null
                    ? 'bg-ui-primary/10 text-ui-primary'
                    : 'text-ui-muted hover:bg-ui-page-alt hover:text-ui-text'
                }`}
              >
                <LayoutDashboard className="w-4 h-4 flex-shrink-0" />
                {!sidebarCollapsed && <span>{lang === 'ar' ? 'الكل' : 'All'}</span>}
              </button>
              {sortedCategories.map(([key, cat]) => {
                const Icon = CATEGORY_ICONS[key as ReportCategory] || BarChart3;
                const count = reportCountByCategory[key] || 0;
                return (
                  <button
                    key={key}
                    onClick={() => setActiveCategory(activeCategory === key ? null : key as ReportCategory)}
                    title={lang === 'ar' ? cat.title : cat.titleEn}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      activeCategory === key
                        ? 'bg-ui-primary/10 text-ui-primary'
                        : 'text-ui-muted hover:bg-ui-page-alt hover:text-ui-text'
                    }`}
                  >
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    {!sidebarCollapsed && (
                      <>
                        <span className="flex-1 text-start truncate">{lang === 'ar' ? cat.title : cat.titleEn}</span>
                        <span className="text-xs text-ui-subtle">{count}</span>
                      </>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>
        </aside>

        {/* Main content area */}
        <div className="flex-1 min-w-0">
          {/* Search bar */}
          <div className="mb-5">
            <div className="relative">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ui-subtle" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={lang === 'ar' ? 'ابحث عن تقرير...' : 'Search reports...'}
                className="w-full h-10 ps-10 pe-4 rounded-xl border border-ui-border bg-ui-surface text-sm text-ui-text placeholder:text-ui-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-ring"
              />
            </div>
          </div>

          {/* Favorites section */}
          {!searchQuery && !activeCategory && favoriteReports.length > 0 && (
            <div className="mb-6">
              <h2 className="flex items-center gap-2 text-xs font-semibold text-ui-muted uppercase tracking-wider mb-3">
                <Star className="w-3.5 h-3.5" />
                {lang === 'ar' ? 'المفضلة' : 'Favorites'}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {favoriteReports.map((r) => (
                  <ReportCard
                    key={r.key}
                    report={r}
                    isActive={activeReport === r.key}
                    isFavorite={true}
                    lang={lang}
                    onSelect={() => onSelectReport(r.key)}
                    onToggleFavorite={(e) => { e.stopPropagation(); toggleFavorite(r.key); }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Recently used section */}
          {!searchQuery && !activeCategory && recentReports.length > 0 && (
            <div className="mb-6">
              <h2 className="flex items-center gap-2 text-xs font-semibold text-ui-muted uppercase tracking-wider mb-3">
                <Clock3 className="w-3.5 h-3.5" />
                {lang === 'ar' ? 'الأخيرة' : 'Recently Used'}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {recentReports.map((r) => (
                  <ReportCard
                    key={r.key}
                    report={r}
                    isActive={activeReport === r.key}
                    isFavorite={favorites.includes(r.key)}
                    lang={lang}
                    onSelect={() => onSelectReport(r.key)}
                    onToggleFavorite={(e) => { e.stopPropagation(); toggleFavorite(r.key); }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Main report grid */}
          <div className="mb-4">
            {!searchQuery && !activeCategory && (favoriteReports.length > 0 || recentReports.length > 0) && (
              <h2 className="flex items-center gap-2 text-xs font-semibold text-ui-muted uppercase tracking-wider mb-3">
                {lang === 'ar' ? 'جميع التقارير' : 'All Reports'}
              </h2>
            )}
            {activeCategory && (
              <h2 className="flex items-center gap-2 text-xs font-semibold text-ui-muted uppercase tracking-wider mb-3">
                {lang === 'ar' ? REPORT_CATEGORIES[activeCategory].title : REPORT_CATEGORIES[activeCategory].titleEn}
                <span className="text-ui-subtle">({visibleReports.length})</span>
              </h2>
            )}
            {searchQuery && (
              <h2 className="flex items-center gap-2 text-xs font-semibold text-ui-muted uppercase tracking-wider mb-3">
                {lang === 'ar' ? 'نتائج البحث' : 'Search Results'}
                <span className="text-ui-subtle">({visibleReports.length})</span>
              </h2>
            )}
            {visibleReports.length === 0 ? (
              <div className="text-center py-16 text-ui-subtle text-sm">
                {lang === 'ar' ? 'لا توجد تقارير مطابقة' : 'No matching reports'}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {visibleReports.map((r) => (
                  <ReportCard
                    key={r.key}
                    report={r}
                    isActive={activeReport === r.key}
                    isFavorite={favorites.includes(r.key)}
                    lang={lang}
                    onSelect={() => onSelectReport(r.key)}
                    onToggleFavorite={(e) => { e.stopPropagation(); toggleFavorite(r.key); }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Active report content */}
          <div className="mt-6">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
