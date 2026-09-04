export type ReportType =
  | 'sales'
  | 'purchases'
  | 'expenses'
  | 'profit'
  | 'inventory'
  | 'sales_by_payment'
  | 'sales_by_employee'
  | 'sales_by_product'
  | 'detailed_invoices'
  | 'component_consumption'
  | 'recipe_costs'
  | 'top_consumed_components'
  | 'top_consumed_products'
  | 'low_stock'
  | 'cashier_performance'
  | 'returns'
  | 'production_waste';

export type ReportFilterKey =
  | 'warehouse'
  | 'cashier'
  | 'customer'
  | 'supplier'
  | 'buyer'
  | 'product'
  | 'category'
  | 'order_type'
  | 'payment_method'
  | 'table'
  | 'status';

export interface ReportFilters {
  warehouse?: string;
  cashier?: string;
  customer?: string;
  supplier?: string;
  buyer?: string;
  product?: string;
  category?: string;
  order_type?: string;
  payment_method?: string;
  table?: string;
  status?: string;
}

export const REPORT_FILTER_KEYS: ReportFilterKey[] = [
  'warehouse',
  'cashier',
  'customer',
  'supplier',
  'buyer',
  'product',
  'category',
  'order_type',
  'payment_method',
  'table',
  'status',
];

export const ALL_REPORT_TYPES: ReportType[] = [
  'sales', 'sales_by_payment', 'sales_by_employee', 'sales_by_product', 'detailed_invoices',
  'purchases', 'expenses', 'profit', 'inventory', 'component_consumption', 'recipe_costs',
  'top_consumed_components', 'top_consumed_products', 'low_stock',
  'cashier_performance', 'returns', 'production_waste',
];

export const REPORT_FILTER_DIMS: Record<ReportType, ReportFilterKey[]> = {
  sales: ['order_type', 'warehouse', 'cashier', 'customer', 'payment_method', 'status'],
  sales_by_payment: ['order_type', 'warehouse', 'cashier', 'payment_method', 'status'],
  sales_by_employee: ['order_type', 'warehouse', 'cashier', 'payment_method', 'status'],
  sales_by_product: ['order_type', 'warehouse', 'cashier', 'customer', 'product', 'category', 'payment_method', 'status'],
  detailed_invoices: ['order_type', 'warehouse', 'cashier', 'customer', 'product', 'category', 'payment_method', 'table', 'status'],
  purchases: ['supplier', 'buyer', 'warehouse', 'status'],
  expenses: ['payment_method', 'category'],
  profit: ['order_type', 'warehouse', 'cashier', 'customer', 'payment_method', 'status'],
  inventory: ['warehouse', 'product', 'category'],
  component_consumption: ['warehouse', 'product', 'category'],
  recipe_costs: ['product', 'category'],
  top_consumed_components: ['warehouse', 'product', 'category'],
  top_consumed_products: ['order_type', 'warehouse', 'cashier', 'customer', 'product', 'category'],
  low_stock: ['warehouse', 'product', 'category'],
  cashier_performance: ['warehouse', 'cashier'],
  returns: ['order_type', 'warehouse', 'cashier', 'customer', 'payment_method', 'status'],
  production_waste: ['warehouse', 'product'],
};

export const DATE_DRIVEN_REPORTS = new Set<ReportType>([
  'sales', 'sales_by_payment', 'sales_by_employee', 'sales_by_product', 'detailed_invoices',
  'purchases', 'expenses', 'profit', 'component_consumption', 'top_consumed_components', 'top_consumed_products',
  'cashier_performance', 'returns', 'production_waste',
]);

export const ORDER_TYPE_OPTIONS: readonly string[] = ['dine_in', 'takeaway', 'delivery', 'drive_thru'];

export const PAYMENT_METHOD_OPTIONS: readonly string[] = ['cash', 'card', 'transfer', 'credit'];

export const SALE_STATUS_OPTIONS: readonly string[] = ['completed', 'refunded', 'cancelled', 'pending'];

export function emptyFilters(): ReportFilters {
  return {};
}

export interface EqBuilder {
  eq(column: string, value: unknown): EqBuilder;
}

export function applySalesFilters<Q extends EqBuilder>(q: Q, f: ReportFilters): Q {
  let result: Q = q;
  if (f.warehouse) result = result.eq('warehouse_id', f.warehouse) as unknown as Q;
  if (f.cashier) result = result.eq('cashier_id', f.cashier) as unknown as Q;
  if (f.customer) result = result.eq('customer_id', f.customer) as unknown as Q;
  if (f.order_type) result = result.eq('order_type', f.order_type) as unknown as Q;
  if (f.payment_method) result = result.eq('payment_method', f.payment_method) as unknown as Q;
  if (f.status) result = result.eq('status', f.status) as unknown as Q;
  if (f.table) result = result.eq('table_id', f.table) as unknown as Q;
  return result;
}

export function applySaleItemFilters<Q extends EqBuilder>(q: Q, f: ReportFilters): Q {
  let result: Q = q;
  if (f.product) result = result.eq('product_id', f.product) as unknown as Q;
  if (f.category) result = result.eq('product.category_id', f.category) as unknown as Q;
  if (f.order_type) result = result.eq('sale.order_type', f.order_type) as unknown as Q;
  if (f.warehouse) result = result.eq('sale.warehouse_id', f.warehouse) as unknown as Q;
  if (f.cashier) result = result.eq('sale.cashier_id', f.cashier) as unknown as Q;
  if (f.customer) result = result.eq('sale.customer_id', f.customer) as unknown as Q;
  if (f.payment_method) result = result.eq('sale.payment_method', f.payment_method) as unknown as Q;
  if (f.status) result = result.eq('sale.status', f.status) as unknown as Q;
  return result;
}

export function applyPurchaseFilters<Q extends EqBuilder>(q: Q, f: ReportFilters): Q {
  let result: Q = q;
  if (f.supplier) result = result.eq('supplier_id', f.supplier) as unknown as Q;
  if (f.buyer) result = result.eq('buyer_id', f.buyer) as unknown as Q;
  if (f.warehouse) result = result.eq('warehouse_id', f.warehouse) as unknown as Q;
  if (f.status) result = result.eq('status', f.status) as unknown as Q;
  return result;
}

export function applyExpenseFilters<Q extends EqBuilder>(q: Q, f: ReportFilters): Q {
  let result: Q = q;
  if (f.payment_method) result = result.eq('payment_method', f.payment_method) as unknown as Q;
  if (f.category) result = result.eq('category', f.category) as unknown as Q;
  return result;
}

export function applyProductScopedFilters<Q extends EqBuilder>(q: Q, f: ReportFilters): Q {
  let result: Q = q;
  if (f.warehouse) result = result.eq('warehouse_id', f.warehouse) as unknown as Q;
  if (f.product) result = result.eq('product_id', f.product) as unknown as Q;
  if (f.category) result = result.eq('product.category_id', f.category) as unknown as Q;
  return result;
}
