import type { Branch } from './organization';

export type Language = 'ar' | 'en';
export type Theme = 'light' | 'dark';

export type Role =
  | 'super_admin'
  | 'owner'
  | 'branch_manager'
  | 'cashier'
  | 'warehouse_manager'
  | 'accountant'
  | 'production_manager';

export interface AppUser {
  id: string;
  email: string;
  username: string | null;
  full_name: string | null;
  role: Role;
  branch_id: string | null;
  is_active: boolean;
  created_at: string;
}

export interface AuditLog {
  id: string;
  user_id: string | null;
  user_email: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  branch_id: string | null;
  created_at: string;
}

export type ShiftStatus = 'open' | 'closed';
export type ShiftOperationType = 'sale' | 'refund' | 'expense' | 'cash_in' | 'cash_out' | 'opening';

export interface Shift {
  id: string;
  branch_id: string;
  cashier_id: string;
  opened_at: string;
  closed_at: string | null;
  opening_amount: number;
  expected_amount: number;
  actual_amount: number | null;
  difference: number;
  status: ShiftStatus;
  notes: string | null;
  created_at: string;
  branch?: Branch;
  cashier?: AppUser;
}

export interface ShiftOperation {
  id: string;
  shift_id: string;
  operation_type: ShiftOperationType;
  amount: number;
  payment_method: string | null;
  reference_type: string | null;
  reference_id: string | null;
  created_by: string | null;
  created_at: string;
}

export interface RpcResult {
  success: boolean;
  error?: string;
  detail?: string;
  sale_id?: string;
  purchase_id?: string;
  invoice_number?: string;
  order_id?: string;
  order_number?: string;
  table_id?: string;
  status?: string;
  batch_number?: string;
  transfer_id?: string;
  transfer_number?: string;
  total_cost?: number;
  unit_cost?: number;
  no_change?: boolean;
  open?: boolean;
  shift_id?: string;
  expected?: number;
  actual?: number;
  difference?: number;
  shift?: {
    id: string;
    branch_id: string;
    cashier_id: string;
    opened_at: string;
    opening_amount: number;
    expected: number;
    cash_sales: number;
    total_sales: number;
    notes: string | null;
  };
}
