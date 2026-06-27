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

  // Resolve a session into user/profile state. MUST NOT be called synchronously
  // from inside onAuthStateChange — supabase.from()/signOut() would deadlock on
  // the auth lock the callback holds. Callers defer it (await / setTimeout).
  syncProfile: async (session, { allowRecovery = false } = {}) => {
    if (!session?.user) {
      set({ user: null, profile: null, session: null, loading: false })
      return
    }
    const profile = await loadProfile(session.user.id)
    if (profile?.is_active === false && !allowRecovery) {
      await supabase.auth.signOut()
      set({ user: null, profile: null, session: null, loading: false })
      return
    }
    set({ user: session.user, profile, session, loading: false })
  },

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
      } else {
        await get().syncProfile(session)
      }
    } catch (err) {
      console.error('Auth initialize error:', err)
      set({ loading: false })
    }

    authListener = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') return

      // A token refresh keeps the same user — just swap in the new session and
      // skip the profile refetch entirely so routine refreshes never block nav.
      if (event === 'TOKEN_REFRESHED') {
        const { user } = get()
        if (session?.user && user?.id === session.user.id) {
          set({ session, user: session.user, loading: false })
          return
        }
      }

      // Defer all Supabase calls so they run AFTER the auth lock is released,
      // otherwise the awaited query/signOut deadlocks every later request.
      setTimeout(() => {
        get().syncProfile(session, { allowRecovery: event === 'PASSWORD_RECOVERY' })
      }, 0)
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
