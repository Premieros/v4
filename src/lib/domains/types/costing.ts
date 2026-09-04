export interface CostingOverviewRow {
  product_id: string;
  product_name: string;
  barcode: string | null;
  sku: string | null;
  category_name: string | null;
  product_type: string;
  sale_price: number;
  unit_cost: number;
  theoretical_cost: number;
  actual_cost: number;
  component_count: number;
  recipe_item_count: number;
}

export interface CostingComponentLine {
  component_product_id: string;
  component_name: string;
  quantity: number;
  unit_cost: number;
  line_cost: number;
}

export interface CostingRecipeLine {
  raw_material_id: string;
  raw_material_name: string;
  quantity: number;
  wastage_percent: number;
  unit_cost: number;
  line_cost: number;
}

export interface CostHistoryRow {
  id: string;
  product_id: string;
  old_cost: number;
  new_cost: number;
  changed_at: string;
  changed_by: string;
  source: string;
}

export interface ProductCostingDetail {
  success: boolean;
  error?: string;
  product_id?: string;
  product_name?: string;
  barcode?: string | null;
  sku?: string | null;
  sale_price?: number;
  unit_cost?: number;
  theoretical_cost?: number;
  actual_cost?: number;
  component_count?: number;
  recipe_item_count?: number;
  components?: CostingComponentLine[];
  recipe_items?: CostingRecipeLine[];
  history?: CostHistoryRow[];
}

export interface SupplierPriceImpactRow {
  item_id: string;
  item_type: 'product' | 'raw_material';
  item_name: string;
  first_cost: number;
  last_cost: number;
  avg_cost: number;
  change_pct: number;
  purchase_count: number;
  last_purchased_at: string | null;
}

export interface OrderMarginRow {
  sale_id: string;
  invoice_number: string;
  branch_id: string | null;
  sale_date: string;
  total: number;
  discount_amount: number;
  cogs: number;
  gross_margin: number;
}
