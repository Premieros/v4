export type PurchaseRequestStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'ordered' | 'cancelled';
export type RfqStatus = 'draft' | 'sent' | 'received' | 'awarded' | 'cancelled';
export type QuotationStatus = 'received' | 'selected' | 'rejected';
export type PurchaseStatus = 'draft' | 'submitted' | 'approved' | 'completed' | 'partial' | 'returned' | 'cancelled';

export interface ProcurementLineInput {
  product_id?: string | null;
  raw_material_id?: string | null;
  quantity: number;
  unit_name?: string;
  unit_cost?: number;
  estimated_cost?: number;
  notes?: string | null;
}

export interface ReceiveLineInput {
  purchase_item_id: string;
  quantity_received: number;
}

export interface PurchaseRequestRow {
  id: string;
  request_number: string;
  branch_id: string;
  supplier_id: string | null;
  status: PurchaseRequestStatus;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  expected_date: string | null;
  notes: string | null;
  requested_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_by: string | null;
  created_at: string;
}

export interface RfqRow {
  id: string;
  rfq_number: string;
  branch_id: string;
  request_id: string | null;
  status: RfqStatus;
  due_date: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface SupplierQuotationRow {
  id: string;
  quotation_number: string;
  branch_id: string;
  rfq_id: string | null;
  supplier_id: string;
  status: QuotationStatus;
  valid_until: string | null;
  delivery_days: number | null;
  total: number;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface RfqComparisonRow {
  item_id: string;
  item_type: 'product' | 'raw_material';
  item_name: string;
  requested_quantity: number;
  best_supplier_id: string | null;
  best_supplier_name: string | null;
  best_unit_cost: number | null;
  avg_unit_cost: number | null;
  quotation_count: number;
  quotations: {
    quotation_id: string;
    supplier_id: string;
    supplier_name: string;
    unit_cost: number;
    quotation_number: string;
    status: string;
  }[];
}

export interface PurchaseBackorderRow {
  id: string;
  purchase_id: string;
  invoice_number: string;
  supplier_id: string;
  supplier_name: string;
  purchase_item_id: string;
  product_id: string | null;
  raw_material_id: string | null;
  item_name: string;
  item_type: 'product' | 'raw_material';
  unit_name: string;
  ordered_quantity: number;
  received_quantity: number;
  remaining: number;
  unit_cost: number;
  status: string;
}

export interface PurchaseReceiptRow {
  id: string;
  receipt_id: string;
  receipt_number: string;
  purchase_id: string;
  invoice_number: string;
  supplier_id: string;
  supplier_name: string;
  branch_id: string;
  warehouse_id: string | null;
  received_by: string;
  received_at: string;
  notes: string | null;
  item_count: number;
  total_quantity: number;
}

export interface SupplierEvaluationRow {
  id: string;
  supplier_id: string;
  supplier_name: string;
  orders_count: number;
  total_purchased: number;
  total_returned: number;
  return_rate: number;
  avg_order_value: number;
  quotations_count: number;
  last_purchase_at: string | null;
}
