import type { Customer } from './parties';
import type { Supplier } from './parties';

export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';

export interface ChartOfAccount {
  id: string;
  branch_id: string;
  code: string;
  name: string;
  name_en: string | null;
  account_type: AccountType;
  is_system: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface JournalEntry {
  id: string;
  entry_number: string;
  branch_id: string;
  entry_date: string;
  reference_type: string;
  reference_id: string | null;
  reference_number: string | null;
  description: string | null;
  created_by: string | null;
  created_at: string;
}

export interface JournalEntryLine {
  id: string;
  journal_entry_id: string;
  account_id: string;
  debit: number;
  credit: number;
  customer_id: string | null;
  supplier_id: string | null;
  note: string | null;
  created_at: string;
  account?: ChartOfAccount;
}

export interface CustomerPayment {
  id: string;
  customer_id: string;
  branch_id: string;
  amount: number;
  payment_method: string;
  sale_id: string | null;
  reference_number: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  customer?: Pick<Customer, 'name'>;
}

export interface TrialBalanceRow {
  code: string;
  name: string;
  name_en: string | null;
  account_type: AccountType;
  debit: number;
  credit: number;
  balance: number;
}

export interface GeneralLedgerRow {
  line_id: string;
  entry_date: string;
  entry_number: string;
  description: string | null;
  reference_number: string | null;
  debit: number;
  credit: number;
  balance: number;
}

export interface IncomeStatementResult {
  revenue: number;
  discount: number;
  net_revenue: number;
  cogs: number;
  gross_profit: number;
  expenses: number;
  net_income: number;
}

export interface BalanceSheetResult {
  assets: number;
  liabilities: number;
  capital: number;
  retained: number;
  net_income: number;
  equity: number;
  balanced: boolean;
}

export interface ArAgingRow {
  id?: string;
  customer_id: string;
  name: string;
  phone: string | null;
  open_amount: number;
  bucket_0_30: number;
  bucket_31_60: number;
  bucket_61_90: number;
  bucket_90_plus: number;
}

export interface ApAgingRow {
  id?: string;
  supplier_id: string;
  name: string;
  phone: string | null;
  open_amount: number;
  bucket_0_30: number;
  bucket_31_60: number;
  bucket_61_90: number;
  bucket_90_plus: number;
}

export interface OpenInvoice {
  invoice_id: string;
  invoice_number: string;
  party_id: string;
  party_name: string;
  party_phone: string | null;
  invoice_date: string;
  due_date: string;
  days_overdue: number;
  invoice_total: number;
  paid: number;
  returned: number;
  open_amount: number;
}

export interface AgingBucket {
  '0_30': number;
  '31_60': number;
  '61_90': number;
  '90_plus': number;
}

export interface AgingSummaryResult {
  as_of: string;
  ar_open: number;
  ap_open: number;
  ar: AgingBucket;
  ap: AgingBucket;
}

export interface SupplierPayment {
  id: string;
  supplier_id: string;
  branch_id: string;
  amount: number;
  payment_method: string;
  purchase_id: string | null;
  reference_number: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  supplier?: Pick<Supplier, 'name'>;
}

export interface TreasuryAccount {
  id: string;
  branch_id: string;
  account_id: string;
  account_type: 'cash' | 'bank';
  account_name: string;
  account_number: string | null;
  is_active: boolean;
  opening_balance: number;
  created_at: string;
  updated_at: string;
}

export interface TreasuryBalance {
  id: string;
  account_type: 'cash' | 'bank';
  account_name: string;
  account_number: string | null;
  code: string;
  is_active: boolean;
  opening_balance: number;
  balance: number;
}

export type TreasuryTransactionType = 'transfer' | 'deposit' | 'withdrawal';

export interface TreasuryTransaction {
  id: string;
  branch_id: string;
  transaction_type: TreasuryTransactionType;
  from_account_id: string | null;
  to_account_id: string | null;
  amount: number;
  reference_number: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  from_account?: Pick<TreasuryAccount, 'account_name'>;
  to_account?: Pick<TreasuryAccount, 'account_name'>;
}

export type ReconciliationStatus = 'open' | 'completed' | 'cancelled';

export interface BankReconciliation {
  id: string;
  branch_id: string;
  treasury_account_id: string;
  statement_date: string;
  statement_balance: number;
  book_balance: number;
  difference: number;
  status: ReconciliationStatus;
  created_by: string | null;
  closed_at: string | null;
  created_at: string;
  treasury_account?: Pick<TreasuryAccount, 'account_name' | 'account_type'>;
}

export interface BankStatementLine {
  id: string;
  reconciliation_id: string;
  statement_date: string;
  description: string | null;
  reference: string | null;
  amount: number;
  matched_journal_entry_id: string | null;
  created_at: string;
}

export interface BookCandidate {
  id: string;
  entry_number: string;
  entry_date: string;
  reference_type: string;
  reference_number: string | null;
  description: string | null;
  amount: number;
}

export interface ReconciliationDetail {
  success: boolean;
  error?: string;
  header: (BankReconciliation & { account_name: string; code: string }) | null;
  statement_lines: BankStatementLine[];
  book_candidates: BookCandidate[];
}

export interface JournalLineDto {
  id: string;
  code: string;
  account_name: string;
  account_type: AccountType;
  debit: number;
  credit: number;
  note: string | null;
  customer_id: string | null;
  supplier_id: string | null;
}

export interface JournalDto {
  id: string;
  entry_number: string;
  entry_date: string;
  reference_type: string;
  reference_id: string | null;
  reference_number: string | null;
  description: string | null;
  created_at: string;
  debit_total: number;
  credit_total: number;
  lines: JournalLineDto[];
}

export interface AuditTrailRow {
  id: string;
  created_at: string;
  action: string;
  entity: string;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  branch_id: string;
  user_id: string | null;
  user_name: string | null;
  user_email: string | null;
}

export interface CashFlowRow {
  treasury_account_id: string;
  account_name: string;
  account_type: 'cash' | 'bank';
  code: string;
  inflow: number;
  outflow: number;
  net: number;
}

export interface PartyStatementRow {
  line_id: string;
  entry_date: string;
  entry_number: string;
  reference_type: string;
  reference_number: string | null;
  description: string | null;
  debit: number;
  credit: number;
  balance: number;
}

export interface PartyStatementResult {
  party_id: string;
  side: string;
  opening: number;
  rows: PartyStatementRow[];
}

export interface TrialBalanceSummary {
  to_date: string;
  total_debit: number;
  total_credit: number;
  balanced: boolean;
}
