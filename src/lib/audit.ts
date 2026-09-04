import { supabase } from './supabase';

export async function logAudit(action: string, entity: string, entityId?: string, details?: Record<string, unknown>): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from('audit_log').insert({
      user_id: user?.id || null,
      user_email: user?.email || null,
      action,
      entity,
      entity_id: entityId || null,
      details: details || null,
    });
  } catch {
    // audit logging should never block the operation
  }
}
