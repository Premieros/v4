import { rpc } from '../rpc';
import type { ApiResult } from '../types';
import type { RpcResult } from '@/lib/types';

export const branches = {
  create(p: {
    p_organization_id: string;
    p_name: string;
    p_name_en?: string | null;
    p_address?: string | null;
    p_phone?: string | null;
  }): ApiResult<RpcResult & { branch_id?: string; warehouse_id?: string }> {
    return rpc('create_organization_branch', p);
  },

  update(p: {
    p_branch_id: string;
    p_name?: string | null;
    p_name_en?: string | null;
    p_address?: string | null;
    p_phone?: string | null;
    p_is_active?: boolean | null;
  }): ApiResult<RpcResult> {
    return rpc('update_branch', p);
  },

  deactivate(p: { p_branch_id: string }): ApiResult<RpcResult> {
    return rpc('deactivate_branch', p);
  },
};
