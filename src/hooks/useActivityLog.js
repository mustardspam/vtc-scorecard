import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export async function logActivity(actionType, description, metadata = {}) {
  try {
    const user = useAuth.getState().user
    await supabase.from('activity_log').insert({
      user_id: user?.id,
      action_type: actionType,
      description,
      metadata,
    })
  } catch (err) {
    console.warn('logActivity failed (non-fatal):', err.message)
  }
}
