export const tradeKey = row => row.vendor_id || `historical:${row.vendor_name}`
export const categoryName = row => row.category_name?.trim() || 'Uncategorized'
export const scoreNumber = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value)

export function buildTrendHistory(snapshots, rows, currentScores) {
  const timeline = snapshots.filter(s => Number.isFinite(Date.parse(s.created_at)))
    .toSorted((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id))
  const bySnapshot = new Map(timeline.map(s => [s.id, new Map()]))
  const trades = new Map()
  // The current Scores roster owns eligibility and display names. Historical
  // snapshots must not resurrect removed, merged, or unscored vendors.
  for (const score of currentScores) {
    if (!score.vendor_id || !score.vendors?.name || scoreNumber(score.weighted_total) === null) continue
    trades.set(score.vendor_id, {
      id: score.vendor_id,
      name: score.vendors.name,
      category: score.vendors.vendor_categories?.name?.trim() || 'Uncategorized',
    })
  }
  for (const row of rows) {
    if (trades.has(row.vendor_id)) bySnapshot.get(row.snapshot_id)?.set(row.vendor_id, row)
  }
  return { timeline, bySnapshot, trades: [...trades.values()].sort((a, b) => a.name.localeCompare(b.name)) }
}

export function trendPoints(history, ids, category, limit = 'all') {
  const timeline = limit === 'all' ? history.timeline : history.timeline.slice(-Number(limit))
  return timeline.map(snapshot => {
    const rows = history.bySnapshot.get(snapshot.id)
    const peers = [...rows.values()].filter(r => categoryName(r) === category)
      .map(r => scoreNumber(r.weighted_total)).filter(v => v !== null)
    return {
      ...snapshot,
      scores: Object.fromEntries(ids.map(id => [id, scoreNumber(rows.get(id)?.weighted_total)])),
      average: peers.length ? peers.reduce((sum, n) => sum + n, 0) / peers.length : null,
      peerCount: peers.length,
    }
  })
}

// Continue until an empty page, including when the server caps pages below our requested size.
export async function fetchAllTrendRows(query, signal) {
  const rows = []
  for (;;) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const { data, error } = await query().range(rows.length, rows.length + 499).abortSignal(signal)
    if (error) throw error
    if (!data?.length) return rows
    rows.push(...data)
  }
}
