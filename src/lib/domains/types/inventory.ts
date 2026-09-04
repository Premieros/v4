import type { Product, Warehouse } from './catalog';
import type { RawMaterial } from './manufacturing';
import type { Branch } from './organization';

export type TransferStatus = 'pending' | 'approved' | 'rejected';

export interface WarehouseTransfer {
  id: string;
  transfer_number: string;
  from_warehouse_id: string;
  to_warehouse_id: string;
  branch_id: string;
  status: TransferStatus;
  reason: string | null;
  notes: string | null;
  requested_by: string | null;
  requested_at: string;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  from_warehouse?: Warehouse;
  to_warehouse?: Warehouse;
  branch?: Branch;
  requester?: import('./users').AppUser;
  approver?: import('./users').AppUser;
  items?: WarehouseTransferItem[];
}

export interface WarehouseTransferItem {
  id: string;
  transfer_id: string;
  product_id: string | null;
  quantity: number;
  unit_cost: number;
  created_at: string;
  product?: Product;
}

export interface TransferItemInput {
  product_id: string;
  quantity: number;
  unit_cost: number;
}

export interface InventoryBatch {
  id: string;
  product_id: string;
  warehouse_id: string;
  branch_id: string;
  batch_number: string | null;
  quantity: number;
  unit_cost: number;
  production_date: string | null;
  expiry_date: string | null;
  source_type: string;
  source_id: string | null;
  created_at: string;
  product?: Product;
  warehouse?: Warehouse;
}

export type LedgerEntryType =
  | 'opening'
  | 'purchase'
  | 'sale'
  | 'refund'
  | 'production'
  | 'waste'
  | 'transfer'
  | 'adjustment';

export interface InventoryLedgerEntry {
  id: number;
  product_id: string | null;
  raw_material_id: string | null;
  branch_id: string;
  warehouse_id: string | null;
  batch_number: string | null;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  before_qty: number | null;
  after_qty: number | null;
  entry_type: LedgerEntryType;
  reference_type: string | null;
  reference_id: string | null;
  reference_number: string | null;
  created_by: string | null;
  created_at: string;
  product?: Product;
  raw_material?: RawMaterial;
  warehouse?: Warehouse;
  branch?: Branch;
}

export interface StockTransaction {
  product_id: string;
  warehouse_id: string | null;
  branch_id: string | null;
  transaction_type: 'sale' | 'purchase' | 'adjustment';
  component_flow: boolean;
  reference_type: string;
  reference_id: string | null;
  quantity: number;
  before_quantity: number;
  after_quantity: number;
  unit_cost: number | null;
  reason: string | null;
  created_by: string | null;
  created_at: string;
  product?: Product;
  warehouse?: Warehouse;
}

export type StockCountType = 'full' | 'partial' | 'cycle';
export type StockCountStatus = 'draft' | 'submitted' | 'approved' | 'applied' | 'rejected';

export interface StockCount {
  id: string;
  count_number: string | null;
  branch_id: string;
  warehouse_id: string;
  status: StockCountStatus;
  count_type: StockCountType;
  notes: string | null;
  rejection_reason: string | null;
  created_by: string | null;
  submitted_by: string | null;
  approved_by: string | null;
  created_at: string;
  submitted_at: string | null;
  approved_at: string | null;
  applied_at: string | null;
  branch?: Branch;
  warehouse?: Warehouse;
  created_user?: { id: string; full_name: string | null; email: string | null } | null;
  items?: StockCountItem[];
}

export interface StockCountItem {
  id: string;
  stock_count_id: string;
  product_id: string;
  system_quantity: number;
  counted_quantity: number;
  variance_quantity: number;
  unit_cost: number;
  variance_value: number;
  reason: string | null;
  product?: Product;
}

export interface LowStockAlertRow {
  product_id: string;
  product_name: string;
  barcode: string | null;
  sku: string | null;
  warehouse_id: string | null;
  warehouse_name: string | null;
  branch_id: string | null;
  quantity: number;
  min_stock: number;
  max_stock: number;
  reorder_point: number;
  low_stock_threshold: number;
  shortage_qty: number;
  status: 'out' | 'low' | 'ok';
}

export interface StockValuationRow {
  product_id: string;
  product_name: string;
  barcode: string | null;
  sku: string | null;
  warehouse_id: string;
  warehouse_name: string | null;
  branch_id: string;
  quantity: number;
  unit_cost: number;
  total_value: number;
}

export interface StockValuationSummaryRow {
  branch_id: string;
  branch_name: string | null;
  total_quantity: number;
  total_value: number;
  item_count: number;
}

export interface ExpiringBatchRow {
  batch_id: string;
  batch_number: string;
  product_id: string;
  product_name: string;
  barcode: string | null;
  warehouse_id: string;
  warehouse_name: string | null;
  branch_id: string;
  quantity: number;
  unit_cost: number;
  production_date: string | null;
  expiry_date: string | null;
  days_to_expiry: number | null;
  status: 'expired' | 'expiring' | 'ok' | 'none';
}
