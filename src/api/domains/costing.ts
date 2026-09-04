import type { ApiResult } from '../types';
import type { CostingOverviewRow, ProductCostingDetail, CostHistoryRow, SupplierPriceImpactRow, OrderMarginRow } from '@/lib/types';
import { rpc } from '../rpc';

export const costing = {
  getOverview(p: { p_branch_id?: string | null }): ApiResult<CostingOverviewRow[]> { return rpc('get_costing_overview', p); },
  getProductDetail(p: { p_product_id: string; p_branch_id?: string | null }): ApiResult<ProductCostingDetail> { return rpc('get_product_costing_detail', p); },
  getCostHistory(p: { p_product_id: string; p_limit?: number }): ApiResult<CostHistoryRow[]> { return rpc('get_cost_history', p); },
  getSupplierPriceImpact(p: { p_supplier_id: string }): ApiResult<SupplierPriceImpactRow[]> { return rpc('get_supplier_price_impact', p); },
  getOrderMargin(p: { p_branch_id?: string | null; p_from?: string | null; p_to?: string | null }): ApiResult<OrderMarginRow[]> { return rpc('get_order_margin', p); },
};
