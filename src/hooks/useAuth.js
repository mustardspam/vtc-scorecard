import { create } from 'zustand'
import { supabase } from '../lib/supabase'

export const useAuth = create((set, get) => ({
  user: null,
  profile: null,
  session: null,
  loading: true,

  initialize: async () => {
    try {
      const { data: { session }, error } = await supabase.auth.getSession()
      if (error) {
        console.error('Auth session error:', error)
        set({ loading: false })
        return
      }
      if (session?.user) {
        const profile = await get().fetchProfile(session.user.id)
        set({ user: session.user, profile, session, loading: false })
      } else {
        set({ loading: false })
      }
    } catch (err) {
      console.error('Auth initialize error:', err)
      set({ loading: false })
    }

    supabase.auth.onAuthStateChange(async (event, session) => {
      // INITIAL_SESSION fires immediately after registration — already handled above
      if (event === 'INITIAL_SESSION') return
      if (session?.user) {
        const profile = await get().fetchProfile(session.user.id)
        set({ user: session.user, profile, session, loading: false })
      } else {
        set({ user: null, profile: null, session: null, loading: false })
      }
    })
  },

  fetchProfile: async (userId) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()
      if (error) console.error('Profile fetch error:', error)
      return data
    } catch (err) {
      console.error('Profile fetch exception:', err)
      return null
    }
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
  isViewer: () => get().profile?.role === 'viewer',
}))
