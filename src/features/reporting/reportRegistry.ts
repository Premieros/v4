import type { ReportType, ReportFilterKey } from './reportFilters';

export type ReportCategory =
  | 'overview'
  | 'sales'
  | 'purchases_expenses'
  | 'inventory'
  | 'manufacturing_costing'
  | 'customers_suppliers'
  | 'employees_shifts'
  | 'treasury_payments'
  | 'financial'
  | 'analytics'
  | 'audit';

export interface ReportDefinition {
  key: ReportType;
  category: ReportCategory;
  title: string;
  titleEn: string;
  description: string;
  descriptionEn: string;
  icon: string;
  permissions: string[];
  filterDimensions: ReportFilterKey[];
  dateDriven: boolean;
  deepLinkKey?: string;
}

export const REPORT_CATEGORIES: Record<ReportCategory, { title: string; titleEn: string; icon: string; order: number }> = {
  overview:              { title: 'نظرة عامة',     titleEn: 'Overview',          icon: 'LayoutDashboard',  order: 0 },
  sales:                 { title: 'المبيعات',       titleEn: 'Sales',             icon: 'TrendingUp',       order: 1 },
  purchases_expenses:    { title: 'المشتريات والمصروفات', titleEn: 'Purchases & Expenses', icon: 'ShoppingCart', order: 2 },
  inventory:             { title: 'المخزون',        titleEn: 'Inventory',         icon: 'Package',          order: 3 },
  manufacturing_costing: { title: 'التصنيع والتكلفة', titleEn: 'Manufacturing & Costing', icon: 'Factory', order: 4 },
  customers_suppliers:   { title: 'العملاء والموردون', titleEn: 'Customers & Suppliers', icon: 'Users', order: 5 },
  employees_shifts:      { title: 'الموظفون والورديات', titleEn: 'Employees & Shifts', icon: 'Clock', order: 6 },
  treasury_payments:     { title: 'الصندوق والمدفوعات', titleEn: 'Treasury & Payments', icon: 'Wallet', order: 7 },
  financial:             { title: 'المالية',         titleEn: 'Financial',         icon: 'Landmark',         order: 8 },
  analytics:             { title: 'التحليلات',       titleEn: 'Analytics',         icon: 'BarChart3',        order: 9 },
  audit:                 { title: 'سجل العمليات',   titleEn: 'Audit Log',         icon: 'FileText',         order: 10 },
};

export const REPORT_REGISTRY: ReportDefinition[] = [
  {
    key: 'sales',
    category: 'sales',
    title: 'تقرير المبيعات',
    titleEn: 'Sales Report',
    description: 'ملخص شامل لمبيعات الفترة مع تفاصيل الطلب',
    descriptionEn: 'Comprehensive sales summary with order details',
    icon: 'TrendingUp',
    permissions: ['reports.view'],
    filterDimensions: ['order_type', 'warehouse', 'cashier', 'customer', 'payment_method', 'status'],
    dateDriven: true,
    deepLinkKey: 'sales',
  },
  {
    key: 'sales_by_payment',
    category: 'analytics',
    title: 'المبيعات حسب طريقة الدفع',
    titleEn: 'Sales by Payment',
    description: 'تحليل المبيعات حسب طريقة الدفع (نقدي / بطاقية / تحويل / آجل)',
    descriptionEn: 'Analyze sales by payment method',
    icon: 'CreditCard',
    permissions: ['reports.view'],
    filterDimensions: ['order_type', 'warehouse', 'cashier', 'payment_method', 'status'],
    dateDriven: true,
    deepLinkKey: 'sales_by_payment',
  },
  {
    key: 'sales_by_employee',
    category: 'employees_shifts',
    title: 'المبيعات حسب الموظف',
    titleEn: 'Sales by Employee',
    description: 'أداء كل موظف من حيث عدد الطلبات والمبلغ',
    descriptionEn: 'Employee performance by orders and revenue',
    icon: 'Users',
    permissions: ['reports.view'],
    filterDimensions: ['order_type', 'warehouse', 'cashier', 'payment_method', 'status'],
    dateDriven: true,
    deepLinkKey: 'sales_by_employee',
  },
  {
    key: 'sales_by_product',
    category: 'sales',
    title: 'المبيعات حسب المنتج',
    titleEn: 'Sales by Product',
    description: 'المنتجات الأكثر مبيعاً مع الكمية والإيراد',
    descriptionEn: 'Top selling products with quantity and revenue',
    icon: 'ShoppingBag',
    permissions: ['reports.view'],
    filterDimensions: ['order_type', 'warehouse', 'cashier', 'customer', 'product', 'category', 'payment_method', 'status'],
    dateDriven: true,
    deepLinkKey: 'sales_by_product',
  },
  {
    key: 'detailed_invoices',
    category: 'sales',
    title: 'الفواتير التفصيلية',
    titleEn: 'Detailed Invoices',
    description: 'كل فاتورة مبيعات مع بنودها التفصيلية',
    descriptionEn: 'Every sales invoice with line item details',
    icon: 'FileText',
    permissions: ['reports.view'],
    filterDimensions: ['order_type', 'warehouse', 'cashier', 'customer', 'product', 'category', 'payment_method', 'table', 'status'],
    dateDriven: true,
    deepLinkKey: 'detailed_invoices',
  },
  {
    key: 'purchases',
    category: 'purchases_expenses',
    title: 'تقرير المشتريات',
    titleEn: 'Purchases Report',
    description: 'مشتريات الفترة مع تفاصيل البنود وال suppliers',
    descriptionEn: 'Period purchases with line items and suppliers',
    icon: 'ShoppingCart',
    permissions: ['reports.view'],
    filterDimensions: ['supplier', 'buyer', 'warehouse', 'status'],
    dateDriven: true,
    deepLinkKey: 'purchases',
  },
  {
    key: 'expenses',
    category: 'purchases_expenses',
    title: 'تقرير المصروفات',
    titleEn: 'Expenses Report',
    description: 'مصروفات الفترة مصنفة حسب النوع',
    descriptionEn: 'Period expenses broken down by category',
    icon: 'Receipt',
    permissions: ['reports.view'],
    filterDimensions: ['payment_method', 'category'],
    dateDriven: true,
    deepLinkKey: 'expenses',
  },
  {
    key: 'profit',
    category: 'sales',
    title: 'تقرير الأرباح',
    titleEn: 'Profit Report',
    description: 'تحليل الربح الإجمالي والصافي مع هامش الربح',
    descriptionEn: 'Gross and net profit analysis with margins',
    icon: 'DollarSign',
    permissions: ['reports.view', 'reports.costing'],
    filterDimensions: ['order_type', 'warehouse', 'cashier', 'customer', 'payment_method', 'status'],
    dateDriven: true,
    deepLinkKey: 'profit',
  },
  {
    key: 'inventory',
    category: 'inventory',
    title: 'تقرير المخزون',
    titleEn: 'Inventory Report',
    description: 'أرصدة المخزون الحالية لكل مخزن ومنتج',
    descriptionEn: 'Current inventory balances by warehouse and product',
    icon: 'Package',
    permissions: ['reports.view'],
    filterDimensions: ['warehouse', 'product', 'category'],
    dateDriven: false,
    deepLinkKey: 'inventory',
  },
  {
    key: 'component_consumption',
    category: 'manufacturing_costing',
    title: 'استهلاك المكونات',
    titleEn: 'Component Consumption',
    description: 'كمية كل مكون مستخدمة في الإنتاج',
    descriptionEn: 'Raw materials consumed during production',
    icon: 'Factory',
    permissions: ['reports.view', 'reports.costing'],
    filterDimensions: ['warehouse', 'product', 'category'],
    dateDriven: true,
    deepLinkKey: 'component_consumption',
  },
  {
    key: 'recipe_costs',
    category: 'manufacturing_costing',
    title: 'تكاليف الوصفات',
    titleEn: 'Recipe Costs',
    description: 'تكلفة كل وصفة بناءً على تكاليف المكونات',
    descriptionEn: 'Cost breakdown for each recipe',
    icon: 'BookOpen',
    permissions: ['reports.view', 'reports.costing'],
    filterDimensions: ['product', 'category'],
    dateDriven: false,
    deepLinkKey: 'recipe_costs',
  },
  {
    key: 'top_consumed_components',
    category: 'manufacturing_costing',
    title: 'المكونات الأكثر استهلاكاً',
    titleEn: 'Top Consumed Components',
    description: 'المكونات الأكثر استخداماً في الإنتاج',
    descriptionEn: 'Most consumed raw materials in production',
    icon: 'BarChart3',
    permissions: ['reports.view', 'reports.costing'],
    filterDimensions: ['warehouse', 'product', 'category'],
    dateDriven: true,
    deepLinkKey: 'top_consumed_components',
  },
  {
    key: 'top_consumed_products',
    category: 'sales',
    title: 'المنتجات الأكثر مبيعاً',
    titleEn: 'Top Consumed Products',
    description: 'المنتجات الأكثر طلباً في المبيعات',
    descriptionEn: 'Most popular products in sales',
    icon: 'Award',
    permissions: ['reports.view'],
    filterDimensions: ['order_type', 'warehouse', 'cashier', 'customer', 'product', 'category'],
    dateDriven: true,
    deepLinkKey: 'top_consumed_products',
  },
  {
    key: 'low_stock',
    category: 'inventory',
    title: 'تنبيهات المخزون المنخفض',
    titleEn: 'Low Stock Alerts',
    description: 'المنتجات التي وصلت للحد الأدنى',
    descriptionEn: 'Products below minimum stock levels',
    icon: 'AlertTriangle',
    permissions: ['reports.view'],
    filterDimensions: ['warehouse', 'product', 'category'],
    dateDriven: false,
    deepLinkKey: 'low_stock',
  },
  {
    key: 'cashier_performance',
    category: 'employees_shifts',
    title: 'أداء أمين الصندوق',
    titleEn: 'Cashier Performance',
    description: 'تفاصيل أداء كل أمين صندوق من حيث الفواتير والإيراد ومتوسط الفاتورة ونسبة المرتجعات',
    descriptionEn: 'Per-cashier metrics: orders, revenue, avg order, refund rate',
    icon: 'UserCheck',
    permissions: ['reports.view'],
    filterDimensions: ['warehouse', 'cashier'],
    dateDriven: true,
    deepLinkKey: 'cashier_performance',
  },
  {
    key: 'returns',
    category: 'sales',
    title: 'تقرير المرتجعات',
    titleEn: 'Returns Report',
    description: 'الفواتير المُستردّة أو المُلغاة مع التفاصيل',
    descriptionEn: 'Refunded and cancelled orders with details',
    icon: 'RotateCcw',
    permissions: ['reports.view'],
    filterDimensions: ['order_type', 'warehouse', 'cashier', 'customer', 'payment_method', 'status'],
    dateDriven: true,
    deepLinkKey: 'returns',
  },
  {
    key: 'production_waste',
    category: 'manufacturing_costing',
    title: 'هالك الإنتاج',
    titleEn: 'Production Waste',
    description: 'سجل الهالك من جدول waste_entries',
    descriptionEn: 'Waste entries from the waste_entries table',
    icon: 'Trash2',
    permissions: ['reports.view'],
    filterDimensions: ['warehouse', 'product'],
    dateDriven: true,
    deepLinkKey: 'production_waste',
  },
];

export function getReportsByCategory(category: ReportCategory): ReportDefinition[] {
  return REPORT_REGISTRY.filter(r => r.category === category);
}

export function getReportByKey(key: ReportType): ReportDefinition | undefined {
  return REPORT_REGISTRY.find(r => r.key === key);
}

export function getCategoryOrder(category: ReportCategory): number {
  return REPORT_CATEGORIES[category]?.order ?? 999;
}

export function filterReportsByPermission(reports: ReportDefinition[], userPermissions: string[]): ReportDefinition[] {
  return reports.filter(r => r.permissions.every(p => userPermissions.includes(p)));
}

export function searchReports(reports: ReportDefinition[], query: string): ReportDefinition[] {
  const q = query.toLowerCase().trim();
  if (!q) return reports;
  return reports.filter(r =>
    r.title.toLowerCase().includes(q) ||
    r.titleEn.toLowerCase().includes(q) ||
    r.description.toLowerCase().includes(q) ||
    r.descriptionEn.toLowerCase().includes(q) ||
    r.key.toLowerCase().includes(q)
  );
}
