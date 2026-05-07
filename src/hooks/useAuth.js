import { create } from 'zustand'
import { supabase } from '../lib/supabase'

export const useAuth = create((set, get) => ({
  user: null,
  profile: null,
  loading: true,

  initialize: async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.user) {
      const profile = await get().fetchProfile(session.user.id)
      set({ user: session.user, profile, loading: false })
    } else {
      set({ loading: false })
    }

    supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        const profile = await get().fetchProfile(session.user.id)
        set({ user: session.user, profile })
      } else {
        set({ user: null, profile: null })
      }
    })
  },

  fetchProfile: async (userId) => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()
    return data
  },

  login: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    return data
  },

  logout: async () => {
    await supabase.auth.signOut()
    set({ user: null, profile: null })
  },

  isAdmin: () => get().profile?.role === 'admin',
  isManager: () => ['admin', 'manager'].includes(get().profile?.role),
  isBuilder: () => get().profile?.role === 'builder',
  isViewer: () => get().profile?.role === 'viewer',
}))
