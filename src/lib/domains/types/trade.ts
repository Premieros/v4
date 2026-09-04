import type { Customer } from './parties';
import type { Product } from './catalog';
import type { Supplier } from './parties';

export interface Sale {
  id: string;
  invoice_number: string;
  branch_id: string | null;
  warehouse_id: string | null;
  customer_id: string | null;
  cashier_id: string | null;
  salesperson_id: string | null;
  subtotal: number;
  discount_amount: number;
  discount_type: string;
  tax_amount: number;
  bonus_amount: number;
  total: number;
  paid_amount: number;
  payment_method: string;
  status: string;
  order_type: string;
  table_id: string | null;
  notes: string | null;
  created_at: string;
  customer?: Customer;
  sale_items?: SaleItem[];
}

export interface SaleItem {
  id: string;
  sale_id: string;
  product_id: string | null;
  unit_name: string;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  bonus_quantity: number;
  total: number;
  created_at: string;
  product?: Product;
}

export interface Purchase {
  id: string;
  invoice_number: string;
  supplier_id: string | null;
  branch_id: string | null;
  warehouse_id: string | null;
  buyer_id: string | null;
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  total: number;
  paid_amount: number;
  payment_method: string;
  status: string;
  notes: string | null;
  created_at: string;
  supplier?: Supplier;
  purchase_items?: PurchaseItem[];
}

export interface PurchaseItem {
  id: string;
  purchase_id: string;
  product_id: string | null;
  unit_name: string;
  quantity: number;
  unit_cost: number;
  total: number;
  created_at: string;
  product?: Product;
}

export interface Expense {
  id: string;
  category: string | null;
  description: string | null;
  amount: number;
  branch_id: string | null;
  payment_method: string;
  expense_date: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}
