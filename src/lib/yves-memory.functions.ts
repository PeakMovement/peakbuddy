import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

export type YvesMemoryScope =
  | 'global'
  | 'insight'
  | 'triage'
  | 'pain_symptoms'
  | 'sleep'
  | 'stress'
  | 'wearable'
  | 'risk';

export const getActiveYvesMemory = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { scope: YvesMemoryScope }) => input)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const scopes =
      data.scope === 'global' ? ['global'] : ['global', data.scope];

    const { data: rows, error } = await supabase
      .from('yves_memory')
      .select('*')
      .eq('is_active', true)
      .in('scope', scopes)
      .order('rule_type', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) throw new Error(error.message);
    return rows ?? [];
  });
