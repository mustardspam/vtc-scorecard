import { useEffect } from 'react'
import { create } from 'zustand'
import { supabase } from '../lib/supabase'

const PAGE_SIZE = 1000
const MAX_PAGES = 50
const CACHE_MS = 60_000

// Loads the most recent permit import and its full normalized series. The latest
// import carries the full trailing window, so it is treated as the source of
// truth for everything displayed; older imports are kept only for audit/history.
async function fetchPaged(table, columns, importId) {
  let all = []
  let from = 0
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .eq('import_id', importId)
      .order('period_month')
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    if (!data?.length) break
    all.push(...data)
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return all
}

const usePermitStore = create((set, get) => ({
  importMeta: null,
  rows: [],
  rbRows: [],
  imports: [],
  loading: false,
  loadedAt: 0,
  error: '',

  load: async (force = false) => {
    const { loadedAt, loading } = get()
    if (!force && loadedAt && Date.now() - loadedAt < CACHE_MS) return
    if (loading) return

    set({ loading: true, error: '' })
    try {
      const { data: importsList, error: impErr } = await supabase
        .from('permit_imports')
        .select('*')
        .order('report_month', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(24)
      if (impErr) throw impErr

      const latest = importsList?.[0] || null
      // Marginal 24-month series (total/region/builder) and the crossed
      // region x builder slice both come from the latest import.
      const [series, rb] = latest
        ? await Promise.all([
            fetchPaged('permit_series', 'scope_type, scope_name, period_month, permits', latest.id),
            fetchPaged('permit_rb_series', 'region, builder, period_month, permits', latest.id),
          ])
        : [[], []]
      set({ imports: importsList || [], importMeta: latest, rows: series, rbRows: rb, loadedAt: Date.now(), loading: false })
    } catch (err) {
      console.error('usePermitData load error:', err)
      set({ error: 'Could not load permit data. Please refresh.', loading: false })
    }
  },
}))

export function usePermitData() {
  const importMeta = usePermitStore(s => s.importMeta)
  const rows = usePermitStore(s => s.rows)
  const rbRows = usePermitStore(s => s.rbRows)
  const imports = usePermitStore(s => s.imports)
  const loading = usePermitStore(s => s.loading)
  const loadedAt = usePermitStore(s => s.loadedAt)
  const error = usePermitStore(s => s.error)
  const load = usePermitStore(s => s.load)

  useEffect(() => {
    if (!loadedAt && !loading) load()
  }, [loadedAt, loading, load])

  return {
    importMeta,
    rows,
    rbRows,
    imports,
    loading: loading && !loadedAt,
    error,
    refresh: () => load(true),
  }
}
