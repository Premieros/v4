import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeftRight, BadgeDollarSign, BarChart3, BookOpenText, Building2,
  Calculator, ChefHat, ClipboardCheck, ClipboardList, CreditCard, Factory, FileSpreadsheet,
  FileText, FlaskConical, HandCoins, Landmark, Layers, LayoutDashboard, Package,
  Receipt, Scale, ScrollText, Settings, ShoppingCart, SlidersHorizontal,
  Store, Tags, Timer, Trash2, Truck, UserCog, Users, Wallet, Warehouse,
} from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useCan, isAdminRole, type Permission } from '@/lib/permissions';
import { APP_ROUTES } from '@/core/navigation/routes';
import { MENU_ITEMS } from '@/core/navigation/menu.config';

const ICON_MAP: Record<string, typeof Package> = {
  dashboard: LayoutDashboard, subscription: CreditCard, pos: ShoppingCart, products: Package,
  categories: Tags, components: Layers, rawMaterials: FlaskConical, recipes: ChefHat,
  inventory: Warehouse, warehouses: Warehouse, production: Factory, transfers: ArrowLeftRight,
  inventoryLedger: BookOpenText, stockCounts: ClipboardCheck, inventoryBatches: Layers,
  stockValuation: BadgeDollarSign, lowStockAlerts: AlertTriangle, inventoryUnits: Package,
  wasteCenter: Trash2, kitchenDisplay: ChefHat, kitchenStations: SlidersHorizontal,
  costingCenter: Calculator, branches: Store, purchases: Truck, customers: Users,
  suppliers: Building2, expenses: Receipt, accounts: Landmark, payments: HandCoins,
  journal: ClipboardList, treasury: Wallet, reconciliation: Scale, financialReports: FileSpreadsheet,
  sales: FileText, shifts: Timer, reports: BarChart3, users: UserCog, subscriptionsAdmin: CreditCard,
  auditLog: ScrollText, settings: Settings,
};

export interface CommandItem {
  id: string;
  route: string;
  labelAr: string;
  labelEn: string;
  section: string;
  sectionAr: string;
  descriptionAr: string;
  descriptionEn: string;
  permission?: Permission;
  icon: typeof Package;
  superAdminOnly?: boolean;
  ownerOnly?: boolean;
}

const LABEL_MAP: Record<string, { ar: string; en: string }> = {
  dashboard: { ar: 'لوحة التحكم', en: 'Dashboard' },
  pos: { ar: 'نقطة البيع', en: 'POS' },
  products: { ar: 'المنتجات', en: 'Products' },
  categories: { ar: 'الأصناف', en: 'Categories' },
  components: { ar: 'المكونات', en: 'Components' },
  inventoryUnits: { ar: 'وحدات المخزون', en: 'Inventory Units' },
  inventory: { ar: 'المخزون', en: 'Inventory' },
  warehouses: { ar: 'المستودعات', en: 'Warehouses' },
  branches: { ar: 'الفروع', en: 'Branches' },
  customers: { ar: 'العملاء', en: 'Customers' },
  suppliers: { ar: 'الموردون', en: 'Suppliers' },
  purchases: { ar: 'المشتريات', en: 'Purchases' },
  expenses: { ar: 'المصروفات', en: 'Expenses' },
  chartOfAccounts: { ar: 'شجرة الحسابات', en: 'Chart of Accounts' },
  receivePayment: { ar: 'المدفوعات', en: 'Payments' },
  journalEntries: { ar: 'القيود اليومية', en: 'Journal Entries' },
  treasury: { ar: 'الخزينة', en: 'Treasury' },
  bankReconciliation: { ar: 'التسوية البنكية', en: 'Bank Reconciliation' },
  financialReports: { ar: 'التقارير المالية', en: 'Financial Reports' },
  salesInvoices: { ar: 'فواتير البيع', en: 'Sales Invoices' },
  shifts: { ar: 'الشيفتات', en: 'Shifts' },
  reports: { ar: 'التقارير', en: 'Reports' },
  users: { ar: 'المستخدمون', en: 'Users' },
  auditLog: { ar: 'سجل التدقيق', en: 'Audit Log' },
  settings: { ar: 'الإعدادات', en: 'Settings' },
  superAdmin: { ar: 'لوحة المدير العام', en: 'Super Admin Console' },
  mySubscription: { ar: 'اشتراكي', en: 'My Subscription' },
  subscriptionsAdmin: { ar: 'إدارة الاشتراكات', en: 'Subscriptions' },
  orders: { ar: 'الطلبات', en: 'Orders' },
  kitchenDisplay: { ar: 'شاشة المطبخ', en: 'Kitchen Display' },
  kitchenStations: { ar: 'محطات المطبخ', en: 'Kitchen Stations' },
  wasteCenter: { ar: 'مركز الهالك', en: 'Waste Center' },
  costingCenter: { ar: 'مركز التكلفة', en: 'Costing Center' },
};

const GROUP_LABELS: Record<string, { ar: string; en: string }> = {
  main: { ar: 'الرئيسية', en: 'Main' },
  catalog: { ar: 'الكتالوج', en: 'Catalog' },
  operations: { ar: 'العمليات', en: 'Operations' },
  centers: { ar: 'مراكز الإدارة', en: 'Centers' },
  people: { ar: 'الأطراف', en: 'People' },
  finance: { ar: 'المالية', en: 'Finance' },
  admin: { ar: 'الإدارة', en: 'Admin' },
};

function buildCommandItems(): CommandItem[] {
  const items: CommandItem[] = [];

  for (const mi of MENU_ITEMS) {
    const labels = LABEL_MAP[mi.labelKey] ?? { ar: mi.labelKey, en: mi.labelKey };
    const groupLabels = GROUP_LABELS[mi.group] ?? { ar: mi.group, en: mi.group };
    items.push({
      id: mi.id,
      route: mi.route,
      labelAr: labels.ar,
      labelEn: labels.en,
      section: groupLabels.en,
      sectionAr: groupLabels.ar,
      descriptionAr: '',
      descriptionEn: '',
      permission: mi.permission,
      icon: ICON_MAP[mi.icon] ?? Package,
      superAdminOnly: mi.superAdminOnly,
      ownerOnly: mi.ownerOnly,
    });
  }

  const extras: Omit<CommandItem, 'icon'>[] = [
    { id: 'cmd-raw-materials', route: APP_ROUTES.rawMaterials, labelAr: 'المواد الخام', labelEn: 'Raw Materials', section: 'Manufacturing', sectionAr: 'التصنيع', descriptionAr: 'تعريف المواد الخام ومتابعة الأرصدة', descriptionEn: 'Manage raw materials and stock', permission: 'raw_materials.view' },
    { id: 'cmd-recipes', route: APP_ROUTES.recipes, labelAr: 'الوصفات والمكونات', labelEn: 'Recipes & Components', section: 'Manufacturing', sectionAr: 'التصنيع', descriptionAr: 'إدارة الوصفات ومكونات المنتجات', descriptionEn: 'Manage recipes and product components', permission: 'recipes.view' },
    { id: 'cmd-production', route: APP_ROUTES.production, labelAr: 'أوامر الإنتاج', labelEn: 'Production Orders', section: 'Manufacturing', sectionAr: 'التصنيع', descriptionAr: 'إنشاء ومتابعة أوامر الإنتاج', descriptionEn: 'Create and monitor production orders', permission: 'production.view' },
    { id: 'cmd-transfers', route: APP_ROUTES.transfers, labelAr: 'التحويلات المخزنية', labelEn: 'Warehouse Transfers', section: 'Inventory', sectionAr: 'المخزون', descriptionAr: 'نقل الأصناف بين المستودعات والفروع', descriptionEn: 'Move stock between warehouses', permission: 'inventory.transfers' },
    { id: 'cmd-ledger', route: APP_ROUTES.inventoryLedger, labelAr: 'دفتر حركة المخزون', labelEn: 'Inventory Ledger', section: 'Inventory', sectionAr: 'المخزون', descriptionAr: 'تتبع كل حركة دخول وخروج وتحويل', descriptionEn: 'Trace stock movements', permission: 'inventory.ledger.view' },
    { id: 'cmd-stock-counts', route: APP_ROUTES.stockCounts, labelAr: 'الجرد والتسويات', labelEn: 'Stock Counts & Adjustments', section: 'Inventory', sectionAr: 'المخزون', descriptionAr: 'الجرد الفعلي وتسويات المخزون', descriptionEn: 'Physical counts and stock adjustments', permission: 'inventory.manage' },
    { id: 'cmd-batches', route: APP_ROUTES.inventoryBatches, labelAr: 'التشغيلات والصلاحية', labelEn: 'Batches & Expiry', section: 'Inventory', sectionAr: 'المخزون', descriptionAr: 'متابعة التشغيلات وتواريخ الصلاحية', descriptionEn: 'Track batches and expiry dates', permission: 'inventory.view' },
    { id: 'cmd-valuation', route: APP_ROUTES.stockValuation, labelAr: 'تقييم المخزون', labelEn: 'Stock Valuation', section: 'Inventory', sectionAr: 'المخزون', descriptionAr: 'قيمة المخزون وتكلفته', descriptionEn: 'Inventory value and cost', permission: 'inventory.ledger.view' },
    { id: 'cmd-low-stock', route: APP_ROUTES.lowStockAlerts, labelAr: 'تنبيهات النقص', labelEn: 'Low Stock Alerts', section: 'Inventory', sectionAr: 'المخزون', descriptionAr: 'الأصناف التي تحتاج إعادة طلب', descriptionEn: 'Items requiring replenishment', permission: 'inventory.view' },
    { id: 'cmd-purchase-requests', route: APP_ROUTES.purchaseRequests, labelAr: 'طلبات الشراء', labelEn: 'Purchase Requests', section: 'Procurement', sectionAr: 'المشتريات', descriptionAr: 'متابعة الطلبات قبل إنشاء أمر شراء', descriptionEn: 'Track requests before purchase orders', permission: 'purchases.requests' },
    { id: 'cmd-rfqs', route: APP_ROUTES.rfqs, labelAr: 'عروض الأسعار', labelEn: 'RFQs & Quotations', section: 'Procurement', sectionAr: 'المشتريات', descriptionAr: 'مقارنة عروض الموردين', descriptionEn: 'Compare supplier quotations', permission: 'purchases.rfq' },
    { id: 'cmd-receiving', route: APP_ROUTES.receiving, labelAr: 'استلام المشتريات', labelEn: 'Receiving', section: 'Procurement', sectionAr: 'المشتريات', descriptionAr: 'استلام الأصناف ومطابقة الكميات', descriptionEn: 'Receive items and reconcile quantities', permission: 'purchases.receiving' },
    { id: 'cmd-floor-plan', route: APP_ROUTES.floorPlan, labelAr: 'مخطط الصالة والطاولات', labelEn: 'Floor Plan & Tables', section: 'Operations', sectionAr: 'العمليات', descriptionAr: 'إدارة الطاولات ومخطط الصالة', descriptionEn: 'Manage tables and floor plan', permission: 'floor_plan.view' },
    { id: 'cmd-system-health', route: APP_ROUTES.systemHealth, labelAr: 'فحص صحة النظام', labelEn: 'System Health', section: 'Admin', sectionAr: 'الإدارة', descriptionAr: 'سلامة قاعدة البيانات وواجهات RPC', descriptionEn: 'Database and RPC integrity', permission: 'settings.manage' },
  ];

  for (const e of extras) {
    items.push({ ...e, icon: ICON_MAP[e.route === APP_ROUTES.rawMaterials ? 'rawMaterials' : e.route === APP_ROUTES.recipes ? 'recipes' : e.route === APP_ROUTES.production ? 'production' : e.route === APP_ROUTES.transfers ? 'transfers' : e.route === APP_ROUTES.inventoryLedger ? 'inventoryLedger' : e.route === APP_ROUTES.stockCounts ? 'stockCounts' : e.route === APP_ROUTES.inventoryBatches ? 'inventoryBatches' : e.route === APP_ROUTES.stockValuation ? 'stockValuation' : e.route === APP_ROUTES.lowStockAlerts ? 'lowStockAlerts' : e.route === APP_ROUTES.purchaseRequests ? 'purchases' : e.route === APP_ROUTES.rfqs ? 'purchases' : e.route === APP_ROUTES.receiving ? 'purchases' : e.route === APP_ROUTES.floorPlan ? 'pos' : e.route === APP_ROUTES.systemHealth ? 'settings' : 'products'] ?? Package });
  }

  return items;
}

const ALL_COMMANDS = buildCommandItems();

function matchesQuery(item: CommandItem, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return item.labelAr.includes(q) || item.labelEn.toLowerCase().includes(q) || item.sectionAr.includes(q) || item.section.toLowerCase().includes(q) || item.descriptionAr.includes(q) || item.descriptionEn.toLowerCase().includes(q) || item.route.includes(q);
}

export function CommandPalette() {
  const { lang } = useLanguage();
  const { user } = useAuth();
  const can = useCan();
  const navigate = useNavigate();
  const ar = lang === 'ar';
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const isOwner = isAdminRole(user?.role);
    return ALL_COMMANDS.filter((item) => {
      if (item.superAdminOnly && user?.role !== 'super_admin') return false;
      if (item.ownerOnly && !isOwner) return false;
      if (item.permission && !can(item.permission)) return false;
      return matchesQuery(item, query);
    });
  }, [query, can, user?.role]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const handleSelect = useCallback((item: CommandItem) => {
    setOpen(false);
    navigate(item.route);
  }, [navigate]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && filtered[selectedIndex]) {
        e.preventDefault();
        handleSelect(filtered[selectedIndex]);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, filtered, selectedIndex, handleSelect]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]" data-testid="command-palette">
      <div className="fixed inset-0 bg-slate-950/60 transition-opacity" onClick={() => setOpen(false)} />
      <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-2xl border border-ui-border bg-ui-surface shadow-2xl">
        <div className="flex items-center gap-3 border-b border-ui-border px-4 bg-ui-surface">
          <SlidersHorizontal className="h-4 w-4 shrink-0 text-ui-subtle" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={ar ? 'ابحث عن صفحة أو وظيفة...' : 'Search pages and features...'}
            className="flex-1 bg-transparent py-3.5 text-sm text-ui-text placeholder-ui-subtle outline-none"
            data-testid="command-palette-input"
          />
          <kbd className="hidden rounded-md border border-ui-border bg-ui-page px-1.5 py-0.5 text-[10px] font-medium text-ui-subtle sm:inline">ESC</kbd>
        </div>
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-1.5" data-testid="command-palette-list">
          {filtered.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-ui-subtle">{ar ? 'لا توجد نتائج' : 'No results found'}</p>
          )}
          {filtered.map((item, i) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelect(item)}
                onMouseEnter={() => setSelectedIndex(i)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-start transition ${
                  i === selectedIndex ? 'bg-ui-primary-soft' : 'hover:bg-ui-page-alt'
                }`}
                data-testid={`command-item-${item.id}`}
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ui-page-alt text-ui-primary">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ui-text">
                    {ar ? item.labelAr : item.labelEn}
                  </p>
                  <p className="truncate text-xs text-ui-subtle">
                    {ar ? item.sectionAr : item.section}
                    {item.descriptionAr || item.descriptionEn ? ` — ${ar ? item.descriptionAr : item.descriptionEn}` : ''}
                  </p>
                </div>
                <span className="hidden shrink-0 text-xs text-ui-subtle sm:inline">{item.route}</span>
              </button>
            );
          })}
        </div>
        <div className="border-t border-ui-border px-4 py-2 text-[11px] text-ui-subtle">
          {ar ? 'Ctrl+K للفتح والإغلاق' : 'Ctrl+K to open and close'}
        </div>
      </div>
    </div>
  );
}

export function CommandPaletteTrigger() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';

  const triggerOpen = useCallback(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
  }, []);

  return (
    <button
      type="button"
      onClick={triggerOpen}
      data-testid="command-palette-trigger"
      className="flex items-center gap-2 rounded-xl border border-ui-border bg-ui-surface px-3 py-2 text-xs font-semibold text-ui-subtle transition hover:bg-ui-page-alt hover:text-ui-text"
      aria-label={ar ? 'بحث سريع (Ctrl+K)' : 'Quick search (Ctrl+K)'}
    >
      <SlidersHorizontal className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">{ar ? 'بحث...' : 'Search...'}</span>
      <kbd className="hidden rounded border border-ui-border bg-ui-page px-1 py-0.5 text-[9px] font-medium sm:inline">⌘K</kbd>
    </button>
  );
}
