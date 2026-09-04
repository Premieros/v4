import type { ApiResult } from '../types';
import type { RpcResult, ProcurementLineInput, ReceiveLineInput, RfqComparisonRow, PurchaseBackorderRow, PurchaseReceiptRow, SupplierEvaluationRow } from '@/lib/types';
import { rpc } from '../rpc';

export const procurement = {
  createPurchaseRequest(p: { p_branch_id: string; p_supplier_id?: string | null; p_priority?: string; p_expected_date?: string | null; p_notes?: string | null; p_items?: ProcurementLineInput[] | null }): ApiResult<RpcResult & { request_id?: string; request_number?: string; items_added?: number }> { return rpc('create_purchase_request', p); },
  updatePurchaseRequestStatus(p: { p_request_id: string; p_status: string }): ApiResult<RpcResult> { return rpc('update_purchase_request_status', p); },
  createRfq(p: { p_branch_id: string; p_request_id?: string | null; p_due_date?: string | null; p_notes?: string | null; p_items?: ProcurementLineInput[] | null }): ApiResult<RpcResult & { rfq_id?: string; rfq_number?: string; items_added?: number }> { return rpc('create_rfq', p); },
  updateRfqStatus(p: { p_rfq_id: string; p_status: string }): ApiResult<RpcResult> { return rpc('update_rfq_status', p); },
  recordSupplierQuotation(p: { p_rfq_id: string; p_supplier_id: string; p_valid_until?: string | null; p_delivery_days?: number | null; p_notes?: string | null; p_items: ProcurementLineInput[] }): ApiResult<RpcResult & { quotation_id?: string; quotation_number?: string; items_added?: number; total?: number }> { return rpc('record_supplier_quotation', p); },
  selectSupplierQuotation(p: { p_quotation_id: string }): ApiResult<RpcResult> { return rpc('select_supplier_quotation', p); },
  getRfqComparison(p: { p_rfq_id: string }): ApiResult<RfqComparisonRow[]> { return rpc('get_rfq_comparison', p); },
  createPurchaseOrder(p: { p_branch_id: string; p_supplier_id: string; p_warehouse_id?: string | null; p_payment_method?: string; p_notes?: string | null; p_items?: ProcurementLineInput[] | null; p_quotation_id?: string | null }): ApiResult<RpcResult & { purchase_id?: string; invoice_number?: string; items_added?: number }> { return rpc('create_purchase_order', p); },
  updatePurchaseOrderStatus(p: { p_purchase_id: string; p_status: string }): ApiResult<RpcResult> { return rpc('update_purchase_order_status', p); },
  receivePurchaseOrder(p: { p_purchase_id: string; p_receipt_items: ReceiveLineInput[] }): ApiResult<RpcResult & { receipt_id?: string; receipt_number?: string; items_received?: number; fully_received?: boolean }> { return rpc('receive_purchase_order', p); },
  getPurchaseBackorders(p: { p_branch_id?: string | null }): ApiResult<PurchaseBackorderRow[]> { return rpc('get_purchase_backorders', p); },
  getPurchaseReceipts(p: { p_branch_id?: string | null }): ApiResult<PurchaseReceiptRow[]> { return rpc('get_purchase_receipts', p); },
  getSupplierEvaluation(p: { p_branch_id?: string | null }): ApiResult<SupplierEvaluationRow[]> { return rpc('get_supplier_evaluation', p); },
};
