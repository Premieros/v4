export interface ApiError {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
}

export type ApiResult<T> = Promise<{ data: T | null; error: ApiError | null }>;

export interface SaleItemInput {
  product_id: string;
  unit_name: string;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  bonus_quantity: number;
  total: number;
}

export interface PurchaseItemInput {
  raw_material_id?: string;
  product_id?: string;
  unit_name: string;
  quantity: number;
  unit_cost: number;
}

export interface JournalLineInput {
  account_code: string;
  debit: number;
  credit: number;
  note?: string | null;
}

export interface RefundItemInput {
  sale_item_id: string;
  quantity: number;
}

export interface StatementLineInput {
  statement_date: string;
  description?: string | null;
  amount: number;
  reference?: string | null;
}
