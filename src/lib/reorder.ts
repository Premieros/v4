import type { LowStockAlertRow, ProcurementLineInput } from '@/lib/types';

export interface ReorderLine {
  key: string;
  item_type: 'product' | 'raw';
  product_id?: string;
  raw_material_id?: string;
  name: string;
  unit_name: string;
  on_hand: number;
  min_stock: number;
  max_stock: number;
  reorder_point: number;
  suggested_qty: number;
  estimated_cost: number;
}

export interface RawReorderSource {
  raw_material_id: string;
  name: string;
  unit_name: string | null;
  quantity: number;
  min_stock: number;
  default_cost: number;
}

export function suggestProductReorderQty(a: {
  on_hand: number;
  max_stock: number;
  shortage_qty: number;
  status: string;
}): number {
  const onHand = Number(a.on_hand) || 0;
  const maxStock = Number(a.max_stock) || 0;
  const shortage = Number(a.shortage_qty) || 0;
  let qty = maxStock > 0 ? Math.max(maxStock - onHand, 0) : shortage;
  if (qty <= 0 && a.status === 'out') qty = 1;
  return qty;
}

export function suggestRawReorderQty(row: { quantity: number; min_stock: number }): number {
  const onHand = Number(row.quantity) || 0;
  const minStock = Number(row.min_stock) || 0;
  let qty = minStock > 0 ? Math.max(minStock - onHand, 0) : 0;
  if (qty <= 0 && onHand <= 0) qty = 1;
  return qty;
}

export function buildProductReorderLines(alerts: LowStockAlertRow[]): ReorderLine[] {
  const byProduct = new Map<string, LowStockAlertRow[]>();
  for (const a of alerts) {
    if (!a || a.status === 'ok') continue;
    const list = byProduct.get(a.product_id) || [];
    list.push(a);
    byProduct.set(a.product_id, list);
  }
  const lines: ReorderLine[] = [];
  for (const [productId, list] of byProduct) {
    const first = list[0];
    const onHand = list.reduce((s, r) => s + (Number(r.quantity) || 0), 0);
    const isOut = list.some((r) => r.status === 'out');
    const qty = suggestProductReorderQty({
      on_hand: onHand,
      max_stock: first.max_stock,
      shortage_qty: first.shortage_qty,
      status: isOut ? 'out' : 'low',
    });
    if (qty <= 0) continue;
    lines.push({
      key: `product:${productId}`,
      item_type: 'product',
      product_id: productId,
      name: first.product_name,
      unit_name: 'piece',
      on_hand: onHand,
      min_stock: Number(first.min_stock) || 0,
      max_stock: Number(first.max_stock) || 0,
      reorder_point: Number(first.reorder_point) || 0,
      suggested_qty: qty,
      estimated_cost: 0,
    });
  }
  return lines.sort((a, b) => a.name.localeCompare(b.name));
}

export function buildRawReorderLines(rows: RawReorderSource[]): ReorderLine[] {
  const lines: ReorderLine[] = [];
  for (const r of rows) {
    const qty = suggestRawReorderQty(r);
    if (qty <= 0) continue;
    lines.push({
      key: `raw:${r.raw_material_id}`,
      item_type: 'raw',
      raw_material_id: r.raw_material_id,
      name: r.name,
      unit_name: r.unit_name || 'piece',
      on_hand: Number(r.quantity) || 0,
      min_stock: Number(r.min_stock) || 0,
      max_stock: 0,
      reorder_point: 0,
      suggested_qty: qty,
      estimated_cost: Number(r.default_cost) || 0,
    });
  }
  return lines.sort((a, b) => a.name.localeCompare(b.name));
}

export function reorderLinesToProcurementItems(
  lines: ReorderLine[],
  qtyOverride: Record<string, number>
): ProcurementLineInput[] {
  return lines
    .map((l) => ({
      ...(l.item_type === 'product'
        ? { product_id: l.product_id }
        : { raw_material_id: l.raw_material_id }),
      quantity: qtyOverride[l.key] ?? l.suggested_qty,
      unit_name: l.unit_name,
      estimated_cost: l.estimated_cost > 0 ? l.estimated_cost : undefined,
    }))
    .filter((i) => i.quantity > 0);
}
