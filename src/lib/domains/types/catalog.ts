export type ProductType = 'ready' | 'manufactured';

export interface Category {
  id: string;
  name: string;
  name_en: string | null;
  description: string | null;
  branch_id: string;
  created_at: string;
}

export interface Product {
  id: string;
  name: string;
  name_en: string | null;
  barcode: string | null;
  sku: string | null;
  category_id: string | null;
  description: string | null;
  cost_price: number;
  sale_price: number;
  wholesale_price: number;
  image_url: string | null;
  is_active: boolean;
  low_stock_threshold: number;
  min_stock: number;
  max_stock: number;
  reorder_point: number;
  product_type: ProductType;
  branch_id: string;
  created_at: string;
  category?: Category;
}

export interface ProductUnit {
  id: string;
  product_id: string;
  unit_name: string;
  unit_name_en: string | null;
  conversion_factor: number;
  sale_price: number;
  cost_price: number;
  barcode: string | null;
  is_base: boolean;
  created_at: string;
}

export interface MeasurementUnit {
  id: string;
  code: string;
  name: string;
  symbol: string | null;
  is_active: boolean;
  created_at: string;
}

export interface InventoryUnit {
  id: string;
  code: string;
  name: string;
  name_en: string | null;
  unit_type: 'ready' | 'manufactured';
  category_id: string | null;
  branch_id: string | null;
  cost_price: number;
  sale_price: number;
  min_stock: number;
  max_stock: number;
  reorder_point: number;
  low_stock_threshold: number;
  barcode: string | null;
  sku: string | null;
  description: string | null;
  image_url: string | null;
  is_active: boolean;
  created_at: string;
  category?: Category;
}

export interface ProductUnitLink {
  id: string;
  product_id: string;
  unit_id: string;
  quantity: number;
  created_at: string;
  unit?: InventoryUnit;
}

export interface InventoryUnitRecipe {
  id: string;
  unit_id: string;
  raw_material_id: string;
  quantity: number;
  wastage_percent: number;
  created_at: string;
  raw_material?: unknown;
}

export interface WasteCategory {
  id: string;
  name: string;
  name_en: string | null;
  is_active: boolean;
  created_at: string;
}

export interface WasteEntry {
  id: string;
  branch_id: string;
  waste_category_id: string;
  waste_type: 'raw_material' | 'finished_good' | 'production' | 'expired' | 'damaged';
  raw_material_id: string | null;
  inventory_unit_id: string | null;
  product_id: string | null;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  reason: string | null;
  warehouse_id: string | null;
  employee_id: string | null;
  approved_by: string | null;
  status: 'pending' | 'approved' | 'rejected';
  approved_at: string | null;
  rejection_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  waste_category?: WasteCategory;
}

export interface WasteReportRow {
  waste_category: string;
  waste_type: string;
  total_quantity: number;
  total_cost: number;
  entry_count: number;
}

export interface InventoryUnitProduction {
  id: string;
  unit_id: string;
  branch_id: string;
  warehouse_id: string;
  quantity: number;
  status: 'planned' | 'in_progress' | 'completed' | 'cancelled';
  total_cost: number;
  planned_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface KitchenQueueItem {
  order_id: string;
  order_number: string;
  table_number: number | null;
  station: string;
  kitchen_status: string;
  guest_count: number | null;
  notes: string | null;
  created_at: string;
  items: { product_name: string; quantity: number; modifiers: string | null }[];
  elapsed_seconds: number;
}

export interface KitchenStation {
  id: string;
  code: string;
  name_ar: string;
  name_en: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
}

export type Unit = MeasurementUnit;

export interface ProductComponent {
  id: string;
  product_id: string;
  component_product_id: string;
  quantity: number;
  created_at: string;
  component_product?: Product;
}

export interface ProductComponentInput {
  component_product_id: string;
  quantity: number;
}

export interface CartItem {
  product: Product;
  unit_name: string;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  bonus_quantity: number;
  modifiers?: { name: string }[];
}

export interface Warehouse {
  id: string;
  name: string;
  branch_id: string | null;
  address: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Inventory {
  id: string;
  product_id: string;
  warehouse_id: string;
  quantity: number;
  updated_at: string;
  product?: Product;
  warehouse?: Warehouse;
}
