import { supabase } from './supabase';

export interface AuditEntry {
  action: string;
  entity: string;
  entityId?: string;
  details?: Record<string, unknown>;
}

export function logAudit(action: string, entity: string, entityId?: string, details?: Record<string, unknown>): Promise<void>;
export function logAudit(entry: AuditEntry): Promise<void>;
export async function logAudit(
  actionOrEntry: string | AuditEntry,
  entity?: string,
  entityId?: string,
  details?: Record<string, unknown>,
): Promise<void> {
  const entry: AuditEntry = typeof actionOrEntry === 'string'
    ? { action: actionOrEntry, entity: entity as string, entityId, details }
    : actionOrEntry;

  try {
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from('audit_log').insert({
      user_id: user?.id || null,
      user_email: user?.email || null,
      action: entry.action,
      entity: entry.entity,
      entity_id: entry.entityId || null,
      details: entry.details || null,
    });
  } catch {
    // Audit logging should never block the operation.
  }
}
