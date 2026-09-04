import type { ApiResult } from '../types';
import type { RpcResult } from '@/lib/types';
import { rpc } from '../rpc';

export const admin = {
  createUser(p: { p_email: string; p_password: string; p_full_name: string; p_role: string; p_branch_id: string | null; p_is_active: boolean; p_username: string }): ApiResult<RpcResult> { return rpc('create_user', p); },
  updateUserPassword(p: { p_user_id: string; p_new_password: string }): ApiResult<null> { return rpc('update_user_password', p); },
  deleteUser(p: { p_user_id: string }): ApiResult<null> { return rpc('delete_user', p); },
  getLoginEmail(p: { p_username: string }): ApiResult<{ success?: boolean; email?: string; error?: string }> { return rpc('get_login_email', p); },
  recordLoginFailure(p: { p_username: string }): ApiResult<{ success?: boolean }> { return rpc('record_login_failure', p); },
  recordLoginSuccess(p: { p_user_id: string }): ApiResult<{ success?: boolean; error?: string }> { return rpc('record_login_success', p); },
  seedDemoData(p: { p_branch_id: string }): ApiResult<RpcResult & { seeded?: number; existing?: boolean; products?: number; customers?: number; tables?: number }> { return rpc('seed_demo_data', p); },
  deleteDemoData(p: { p_branch_id: string }): ApiResult<RpcResult & { orders?: number; sales?: number; customers?: number; products?: number; tables?: number }> { return rpc('delete_demo_data', p); },
  deleteDataSection(p: { p_branch_id: string; p_section: string }): ApiResult<RpcResult & { affected?: number; section?: string }> { return rpc('admin_data_delete_section', p); },
  seedAllDemoData(p: { p_branch_id: string }): ApiResult<RpcResult & { seeded?: boolean; section_count?: number }> { return rpc('admin_data_seed_all', p); },
  canCreateNewUser(): ApiResult<{ allowed: boolean; message?: string; is_super_admin?: boolean }> { return rpc('can_create_new_user', {}); },
  toggleUserCreationSetting(p_allowed: boolean): ApiResult<{ success: boolean; allow_new_user_creation?: boolean; error?: string; message?: string }> { return rpc('toggle_user_creation_setting', { p_allowed }); },
  bootstrapInitialSuperAdmin(p: { p_email: string; p_password: string; p_full_name?: string; p_username?: string }): ApiResult<{ success: boolean; user_id?: string; email?: string; error?: string; message?: string }> { return rpc('bootstrap_initial_super_admin', p); },
};