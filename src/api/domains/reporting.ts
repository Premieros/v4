import type { ApiResult } from '../types';
import type { TrialBalanceRow, TrialBalanceSummary, GeneralLedgerRow, IncomeStatementResult, BalanceSheetResult, ArAgingRow, ApAgingRow, AgingSummaryResult, CashFlowRow, PartyStatementResult } from '@/lib/types';
import { rpc } from '../rpc';

export const reporting = {
  getTrialBalance(p: { p_branch_id: string | null; p_to_date: string }): ApiResult<TrialBalanceRow[]> { return rpc('get_trial_balance', p); },
  getTrialBalanceSummary(p: { p_branch_id: string | null; p_to_date: string }): ApiResult<TrialBalanceSummary> { return rpc('get_trial_balance_summary', p); },
  getGeneralLedger(p: { p_branch_id: string | null; p_account_id: string | null; p_from_date: string | null; p_to_date: string | null }): ApiResult<GeneralLedgerRow[]> { return rpc('get_general_ledger', p); },
  getIncomeStatement(p: { p_branch_id: string | null; p_from_date: string; p_to_date: string }): ApiResult<IncomeStatementResult> { return rpc('get_income_statement', p); },
  getBalanceSheet(p: { p_branch_id: string | null; p_as_of: string }): ApiResult<BalanceSheetResult> { return rpc('get_balance_sheet', p); },
  getArAging(p: { p_branch_id: string | null; p_as_of: string }): ApiResult<ArAgingRow[]> { return rpc('get_ar_aging', p); },
  getApAging(p: { p_branch_id: string | null; p_as_of: string }): ApiResult<ApAgingRow[]> { return rpc('get_ap_aging', p); },
  getAgingSummary(p: { p_branch_id: string | null; p_as_of: string }): ApiResult<AgingSummaryResult> { return rpc('get_aging_summary', p); },
  getCashFlow(p: { p_branch_id: string | null; p_from_date: string; p_to_date: string }): ApiResult<CashFlowRow[]> { return rpc('get_cash_flow', p); },
  getPartyStatement(p: { p_branch_id: string | null; p_side: string; p_party_id: string | null; p_from_date: string | null; p_to_date: string | null }): ApiResult<PartyStatementResult> { return rpc('get_party_statement', p); },
};
