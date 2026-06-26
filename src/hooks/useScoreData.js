import { useEffect } from 'react'
import { create } from 'zustand'
import { supabase } from '../lib/supabase'

const SCORES_SELECT = '*, vendors(name, category_id, vendor_categories(name))'
const CACHE_MS = 60_000

const useScoreStore = create((set, get) => ({
  scores: [],
  loading: false,
  loadedAt: 0,
  error: null,

  load: async (force = false) => {
    const { loadedAt, loading, scores } = get()
    if (!force && loadedAt && Date.now() - loadedAt < CACHE_MS) return scores
    if (loading) return scores

    set({ loading: true, error: null })
    try {
      const { data, error } = await supabase
        .from('score_results')
        .select(SCORES_SELECT)
        .order('weighted_total', { ascending: false, nullsFirst: false })
      if (error) throw error
      const rows = data || []
      set({ scores: rows, loadedAt: Date.now(), loading: false })
      return rows
    } catch (err) {
      set({ error: err.message, loading: false })
      throw err
    }
  },

  invalidate: () => set({ loadedAt: 0 }),
}))

export function useScoreData({ autoLoad = true } = {}) {
  const scores = useScoreStore(s => s.scores)
  const loading = useScoreStore(s => s.loading)
  const loadedAt = useScoreStore(s => s.loadedAt)
  const error = useScoreStore(s => s.error)
  const load = useScoreStore(s => s.load)
  const invalidate = useScoreStore(s => s.invalidate)

  useEffect(() => {
    if (autoLoad && !loadedAt && !loading) load()
  }, [autoLoad, loadedAt, loading, load])

  return {
    scores,
    loading,
    loaded: loadedAt > 0,
    error,
    load,
    refresh: () => load(true),
    invalidate,
  }
}

export { SCORES_SELECT }
