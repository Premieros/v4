import type { ApiResult, PurchaseItemInput, RefundItemInput } from '../types';
import type { RpcResult } from '@/lib/types';
import { rpc } from '../rpc';

export const trade = {
  nextDocumentNumber(p: { p_type: string }): ApiResult<RpcResult> { return rpc('next_document_number', p); },
  processPurchase(p: { p_invoice_number: string; p_supplier_id: string; p_branch_id: string | null; p_warehouse_id: string | null; p_subtotal: number; p_discount_amount: number; p_tax_amount: number; p_total: number; p_paid_amount: number; p_payment_method: string; p_status: string; p_notes: string | null; p_items: PurchaseItemInput[] }): ApiResult<RpcResult> { return rpc('process_purchase', p); },
  processRefund(p: { p_sale_id: string; p_items: RefundItemInput[]; p_reason: string | null }): ApiResult<RpcResult> { return rpc('process_refund', p); },
};
