import type { ApiResult } from '../types';
import type { RpcResult, LowStockAlertRow, StockValuationRow, StockValuationSummaryRow, ExpiringBatchRow } from '@/lib/types';
import { rpc } from '../rpc';

export const inventory = {
  adjustStock(p: { p_inventory_id: string; p_new_quantity: number; p_reason: string | null }): ApiResult<RpcResult> { return rpc('adjust_stock', p); },
  adjustRawStock(p: { p_raw_material_id: string; p_branch_id: string; p_new_quantity: number; p_reason: string | null }): ApiResult<RpcResult> { return rpc('adjust_raw_stock', p); },
  createTransfer(p: { p_from_warehouse_id: string; p_to_warehouse_id: string; p_branch_id: string; p_items: { product_id: string; quantity: number; unit_cost: number }[]; p_reason: string | null; p_notes: string | null }): ApiResult<RpcResult> { return rpc('create_warehouse_transfer', p); },
  approveTransfer(p: { p_transfer_id: string }): ApiResult<RpcResult> { return rpc('approve_warehouse_transfer', p); },
  rejectTransfer(p: { p_transfer_id: string; p_reason: string | null }): ApiResult<RpcResult> { return rpc('reject_warehouse_transfer', p); },
  createStockCount(p: { p_branch_id: string; p_warehouse_id: string; p_count_type: string; p_notes: string | null; p_items: { product_id: string; counted_quantity: number | null; reason: string | null }[] | null }): ApiResult<RpcResult & { stock_count_id?: string; count_number?: string; items_added?: number }> { return rpc('create_stock_count', p); },
  addStockCountItem(p: { p_stock_count_id: string; p_product_id: string; p_counted_quantity?: number | null; p_reason?: string | null }): ApiResult<RpcResult> { return rpc('add_stock_count_item', p); },
  updateStockCountItem(p: { p_stock_count_id: string; p_product_id: string; p_counted_quantity: number | null; p_reason?: string | null }): ApiResult<RpcResult> { return rpc('update_stock_count_item', p); },
  removeStockCountItem(p: { p_stock_count_id: string; p_product_id: string }): ApiResult<RpcResult> { return rpc('remove_stock_count_item', p); },
  submitStockCount(p: { p_stock_count_id: string }): ApiResult<RpcResult> { return rpc('submit_stock_count', p); },
  approveStockCount(p: { p_stock_count_id: string }): ApiResult<RpcResult> { return rpc('approve_stock_count', p); },
  rejectStockCount(p: { p_stock_count_id: string; p_reason: string | null }): ApiResult<RpcResult> { return rpc('reject_stock_count', p); },
  applyStockCount(p: { p_stock_count_id: string }): ApiResult<RpcResult & { items_applied?: number }> { return rpc('apply_stock_count', p); },
  addInventoryBatch(p: { p_product_id: string; p_warehouse_id: string; p_branch_id: string; p_quantity: number; p_unit_cost?: number; p_batch_number?: string | null; p_production_date?: string | null; p_expiry_date?: string | null; p_source_type?: string; p_notes?: string | null }): ApiResult<RpcResult> { return rpc('add_inventory_batch', p); },
  getLowStockAlerts(p: { p_branch_id?: string | null; p_warehouse_id?: string | null }): ApiResult<LowStockAlertRow[]> { return rpc('get_low_stock_alerts', p); },
  getLowStockSummary(p: { p_branch_id?: string | null; p_warehouse_id?: string | null }): ApiResult<{ out_count?: number; low_count?: number; ok_count?: number }> { return rpc('get_low_stock_summary', p); },
  getStockValuation(p: { p_branch_id?: string | null; p_warehouse_id?: string | null }): ApiResult<StockValuationRow[]> { return rpc('get_stock_valuation', p); },
  getStockValuationSummary(p: { p_branch_id?: string | null; p_warehouse_id?: string | null }): ApiResult<StockValuationSummaryRow[]> { return rpc('get_stock_valuation_summary', p); },
  getExpiringBatches(p: { p_branch_id?: string | null; p_warehouse_id?: string | null; p_horizon_days?: number }): ApiResult<ExpiringBatchRow[]> { return rpc('get_expiring_batches', p); },
};
