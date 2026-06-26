import { create } from 'zustand'
import { supabase } from '../lib/supabase'

let authListener = null

async function loadProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()
  if (error) console.error('Profile fetch error:', error)
  return data
}

async function ensureActiveAccount(profile) {
  if (profile?.is_active === false) {
    await supabase.auth.signOut()
    throw new Error('Your account has been disabled. Contact an administrator for access.')
  }
}

export const useAuth = create((set, get) => ({
  user: null,
  profile: null,
  session: null,
  loading: true,

  initialize: async () => {
    if (authListener) {
      authListener.subscription.unsubscribe()
      authListener = null
    }

    try {
      const { data: { session }, error } = await supabase.auth.getSession()
      if (error) {
        console.error('Auth session error:', error)
        set({ loading: false })
        return
      }
      if (session?.user) {
        const profile = await loadProfile(session.user.id)
        if (profile?.is_active === false) {
          await supabase.auth.signOut()
          set({ user: null, profile: null, session: null, loading: false })
        } else {
          set({ user: session.user, profile, session, loading: false })
        }
      } else {
        set({ loading: false })
      }
    } catch (err) {
      console.error('Auth initialize error:', err)
      set({ loading: false })
    }

    authListener = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'INITIAL_SESSION') return
      if (session?.user) {
        const profile = await loadProfile(session.user.id)
        if (profile?.is_active === false && event !== 'PASSWORD_RECOVERY') {
          await supabase.auth.signOut()
          set({ user: null, profile: null, session: null, loading: false })
          return
        }
        set({ user: session.user, profile, session, loading: false })
      } else {
        set({ user: null, profile: null, session: null, loading: false })
      }
    })
  },

  fetchProfile: loadProfile,

  login: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    })
    if (error) throw error
    const profile = await loadProfile(data.user.id)
    await ensureActiveAccount(profile)
    set({ user: data.user, profile, session: data.session, loading: false })
    return data
  },

  logout: async () => {
    await supabase.auth.signOut()
    set({ user: null, profile: null, session: null })
  },

  isAdmin: () => get().profile?.role === 'admin',
  isManager: () => ['admin', 'manager'].includes(get().profile?.role),
  isViewer: () => get().profile?.role === 'viewer',
}))
