import { useEffect } from 'react'
import { create } from 'zustand'
import { supabase } from '../lib/supabase'

const useReferenceStore = create((set, get) => ({
  categories: [],
  communities: [],
  weights: null,
  weightId: null,
  loaded: { categories: false, communities: false, weights: false },

  loadCategories: async () => {
    if (get().loaded.categories) return get().categories
    const { data } = await supabase
      .from('vendor_categories')
      .select('id, name, sort_order')
      .order('sort_order')
    const categories = data || []
    set(s => ({ categories, loaded: { ...s.loaded, categories: true } }))
    return categories
  },

  loadCommunities: async () => {
    if (get().loaded.communities) return get().communities
    const { data } = await supabase
      .from('communities')
      .select('id, name, code, brand, is_active')
      .eq('is_active', true)
      .order('name')
    const communities = data || []
    set(s => ({ communities, loaded: { ...s.loaded, communities: true } }))
    return communities
  },

  loadWeights: async (force = false) => {
    if (!force && get().loaded.weights) return get().weights
    const { data } = await supabase.from('score_weights').select('*').eq('is_current', true).single()
    set(s => ({
      weights: data,
      weightId: data?.id ?? null,
      loaded: { ...s.loaded, weights: true },
    }))
    return data
  },

  invalidateWeights: () => set(s => ({ loaded: { ...s.loaded, weights: false } })),
}))

export function useReferenceData({ categories = false, communities = false, weights = false } = {}) {
  const categoriesList = useReferenceStore(s => s.categories)
  const communitiesList = useReferenceStore(s => s.communities)
  const weightsRow = useReferenceStore(s => s.weights)
  const weightId = useReferenceStore(s => s.weightId)
  const loadCategories = useReferenceStore(s => s.loadCategories)
  const loadCommunities = useReferenceStore(s => s.loadCommunities)
  const loadWeights = useReferenceStore(s => s.loadWeights)
  const invalidateWeights = useReferenceStore(s => s.invalidateWeights)

  useEffect(() => {
    if (categories) loadCategories()
  }, [categories, loadCategories])

  useEffect(() => {
    if (communities) loadCommunities()
  }, [communities, loadCommunities])

  useEffect(() => {
    if (weights) loadWeights()
  }, [weights, loadWeights])

  return {
    categories: categoriesList,
    communities: communitiesList,
    weights: weightsRow,
    weightId,
    loadCategories,
    loadCommunities,
    loadWeights,
    invalidateWeights,
  }
}
