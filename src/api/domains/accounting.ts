import type { ApiResult, JournalLineInput } from '../types';
import type { RpcResult, TreasuryBalance, TrialBalanceRow, JournalDto, ArAgingRow, ApAgingRow, ReconciliationDetail } from '@/lib/types';
import { rpc } from '../rpc';

export const accounting = {
  getTrialBalance(p: { p_branch_id: string | null; p_to_date: string }): ApiResult<TrialBalanceRow[]> { return rpc('get_trial_balance', p); },
  seedOpeningBalances(p: { p_branch_id: string | null }): ApiResult<RpcResult> { return rpc('seed_opening_balances', p); },
  getJournals(p: { p_branch_id: string | null; p_from_date: string | null; p_to_date: string | null; p_reference_type: string | null; p_search: string | null }): ApiResult<JournalDto[]> { return rpc('get_journals', p); },
  postManualJournal(p: { p_branch_id: string | null; p_description: string; p_lines: JournalLineInput[] }): ApiResult<RpcResult> { return rpc('post_manual_journal', p); },
  getArAging(p: { p_branch_id: string | null; p_as_of: string }): ApiResult<ArAgingRow[]> { return rpc('get_ar_aging', p); },
  getApAging(p: { p_branch_id: string | null; p_as_of: string }): ApiResult<ApAgingRow[]> { return rpc('get_ap_aging', p); },
  receivePayment(p: { p_customer_id: string; p_branch_id: string | null; p_amount: number; p_payment_method: string; p_sale_id: string | null; p_notes: string | null }): ApiResult<RpcResult> { return rpc('receive_payment', p); },
  paySupplier(p: { p_supplier_id: string; p_branch_id: string | null; p_amount: number; p_payment_method: string; p_purchase_id: string | null; p_notes: string | null }): ApiResult<RpcResult> { return rpc('pay_supplier', p); },
  getTreasuryBalances(p: { p_branch_id: string | null }): ApiResult<TreasuryBalance[]> { return rpc('get_treasury_balances', p); },
  processTransfer(p: { p_branch_id: string | null; p_from_account_id: string; p_to_account_id: string; p_amount: number; p_notes: string | null }): ApiResult<RpcResult> { return rpc('process_transfer', p); },
  processTreasuryDeposit(p: { p_branch_id: string | null; p_account_id: string; p_amount: number; p_notes: string | null }): ApiResult<RpcResult> { return rpc('process_treasury_deposit', p); },
  processTreasuryWithdrawal(p: { p_branch_id: string | null; p_account_id: string; p_amount: number; p_notes: string | null }): ApiResult<RpcResult> { return rpc('process_treasury_withdrawal', p); },
  getBankReconciliation(p: { p_reconciliation_id: string }): ApiResult<ReconciliationDetail> { return rpc('get_bank_reconciliation', p); },
  createBankReconciliation(p: { p_branch_id: string | null; p_treasury_account_id: string; p_statement_date: string; p_statement_balance: number }): ApiResult<RpcResult> { return rpc('create_bank_reconciliation', p); },
  addStatementLine(p: { p_reconciliation_id: string; p_statement_date: string; p_description: string | null; p_amount: number; p_reference: string | null }): ApiResult<RpcResult> { return rpc('add_statement_line', p); },
  matchBankLine(p: { p_line_id: string; p_journal_entry_id: string }): ApiResult<RpcResult> { return rpc('match_bank_line', p); },
  completeBankReconciliation(p: { p_reconciliation_id: string }): ApiResult<RpcResult> { return rpc('complete_bank_reconciliation', p); },
};
