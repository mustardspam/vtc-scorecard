import { createClient } from '@supabase/supabase-js'
import { fetchWithTimeout } from './fetchWithTimeout'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://your-project.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'your-anon-key'

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  global: {
    // Abort stalled requests instead of leaving the UI hung forever. Honors any
    // caller-supplied AbortSignal (e.g. PostgREST .abortSignal()).
    fetch: (input, init) => fetchWithTimeout(input, init),
  },
})
