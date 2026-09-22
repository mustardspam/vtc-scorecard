import { useEffect, useMemo, useState } from 'react'
import { Printer, RefreshCw, TrendingUp, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { SCORES_SELECT } from '../hooks/useScoreData'
import { buildTrendHistory, fetchAllTrendRows, trendPoints } from '../lib/trends'
import './TrendsPage.css'

const COLORS = ['#079db2', '#8755eb', '#e58b13', '#d64f8c', '#4689dc', '#329266']
const date = value => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
const number = value => value == null ? '—' : value.toFixed(1)
const delta = value => value == null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(1)} pts`

function TrendChart({ points, series }) {
  const [active, setActive] = useState(null)
  const width = 1100, height = 370, left = 58, right = 28, top = 20, bottom = 60
  const times = points.map(p => Date.parse(p.created_at))
  const start = times[0], end = times.at(-1)
  const x = i => start === end ? width / 2 : left + (times[i] - start) / (end - start) * (width - left - right)
  const y = value => top + (100 - value) / 100 * (height - top - bottom)
  const valueAt = (p, s) => s.average ? p.average : p.scores[s.id]
  const tickIndices = [...new Set(Array.from({ length: Math.min(6, points.length) }, (_, i) => Math.round(i * (points.length - 1) / Math.max(1, Math.min(6, points.length) - 1))))]
  const selected = active == null ? null : points[active]
  return <>
    <div className="trends-chart-scroll">
      <svg className="trends-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Trade total scores by snapshot date, on a zero to one hundred scale">
        {[0, 20, 40, 60, 80, 100].map(n => <g key={n}>
          <line x1={left} x2={width - right} y1={y(n)} y2={y(n)} stroke="var(--g-line)" />
          <text x={left - 12} y={y(n) + 4} textAnchor="end">{n}</text>
        </g>)}
        <text transform={`translate(15 ${height / 2}) rotate(-90)`} textAnchor="middle">Trend score</text>
        {tickIndices.map(i => <g key={points[i].id}>
          <line x1={x(i)} x2={x(i)} y1={top} y2={height - bottom} stroke="var(--g-line)" />
          <text x={x(i)} y={height - bottom + 23} textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}>{date(points[i].created_at)}</text>
        </g>)}
        <text x={width / 2} y={height - 8} textAnchor="middle">Snapshot date</text>
        {series.map(s => {
          let drawing = false
          const path = points.map((p, i) => {
            const v = valueAt(p, s)
            if (v == null) { drawing = false; return '' }
            const segment = `${drawing ? 'L' : 'M'} ${x(i)} ${y(v)}`
            drawing = true
            return segment
          }).join(' ')
          return <g key={s.id}>
            <path d={path} fill="none" stroke={s.color} strokeWidth={s.primary ? 3 : 2} strokeDasharray={s.average ? '7 5' : undefined} />
            {points.map((p, i) => valueAt(p, s) == null ? null : <circle key={p.id} cx={x(i)} cy={y(valueAt(p, s))} r={s.primary ? 4 : 3} fill={s.color}><title>{s.name}: {number(valueAt(p, s))} · {date(p.created_at)}</title></circle>)}
          </g>
        })}
        {points.map((p, i) => <rect key={p.id} x={x(i) - 8} y={top} width={16} height={height - top - bottom} fill="transparent" tabIndex={0} role="button"
          aria-label={`${p.name}, ${date(p.created_at)}. ${series.map(s => `${s.name}: ${number(valueAt(p, s))}`).join('. ')}`}
          onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)} onClick={() => setActive(i)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActive(i) } }} />)}
      </svg>
    </div>
    <div className="trends-detail" aria-live="polite">
      {selected ? <><strong>{selected.name} · {date(selected.created_at)}</strong><div className="trends-legend">{series.map(s => <span key={s.id}><i style={{ background: s.color }} />{s.name}: <b>{number(valueAt(selected, s))}</b>{s.average && ` (${selected.peerCount} trades)`}</span>)}</div></> : 'Hover, tap, or focus a snapshot to see exact scores.'}
    </div>
  </>
}

export default function TrendsPage() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [tradeId, setTradeId] = useState('')
  const [category, setCategory] = useState('')
  const [comparisons, setComparisons] = useState([])
  const [showAverage, setShowAverage] = useState(true)
  const [range, setRange] = useState('all')
  const [search, setSearch] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const [snapshots, rows, currentScores] = await Promise.all([
          fetchAllTrendRows(() => supabase.from('snapshots').select('id, name, created_at').order('created_at').order('id'), controller.signal),
          fetchAllTrendRows(() => supabase.from('snapshot_score_results').select('id, snapshot_id, vendor_id, vendor_name, category_name, weighted_total').order('id'), controller.signal),
          fetchAllTrendRows(() => supabase.from('score_results').select(SCORES_SELECT).order('vendor_id'), controller.signal),
        ])
        if (!controller.signal.aborted) setData(buildTrendHistory(snapshots, rows, currentScores))
      } catch (err) { if (!controller.signal.aborted) setError(err.message || 'Could not load trend history.') }
    }
    load()
    return () => controller.abort()
  }, [revision])
  const trade = data?.trades.find(t => t.id === tradeId) || data?.trades[0]
  const selectedCategory = category || trade?.category || 'Uncategorized'
  const compareTrades = (data?.trades || []).filter(t => comparisons.includes(t.id) && t.id !== trade?.id)
  const ids = useMemo(() => trade ? [trade.id, ...comparisons.filter(id => id !== trade.id)] : [], [trade, comparisons])
  const points = useMemo(() => data ? trendPoints(data, ids, selectedCategory, range) : [], [data, ids, selectedCategory, range])
  const allPoints = useMemo(() => data ? trendPoints(data, ids, selectedCategory) : [], [data, ids, selectedCategory])
  const scored = allPoints.filter(p => p.scores[trade?.id] != null)
  const latest = scored.at(-1)
  const latestScore = latest?.scores[trade?.id]
  const firstScore = scored[0]?.scores[trade?.id]
  const change = scored.length > 1 ? latestScore - firstScore : null
  const peerDifference = latest?.average != null ? latestScore - latest.average : null
  const series = trade ? [
    { ...trade, color: COLORS[0], primary: true },
    ...compareTrades.map((t, i) => ({ ...t, color: COLORS[i + 1] })),
    ...(showAverage ? [{ id: '__average', name: `${selectedCategory} average`, color: '#748298', average: true }] : []),
  ] : []
  const categories = [...new Set([...(data?.trades.map(t => t.category) || []), ...[...(data?.bySnapshot.values() || [])].flatMap(rows => [...rows.values()].map(r => r.category_name?.trim() || 'Uncategorized'))])].sort()
  function refresh() { setData(null); setError(''); setRevision(n => n + 1) }
  return <section className="trends-page">
    <div className="trends-heading"><div><h1>Trends</h1><p>Track trade performance from the first snapshot to the latest.</p></div>
      <div className="trends-actions"><button className="trends-button" onClick={refresh} disabled={!data && !error}><RefreshCw size={16} />Refresh</button><button className="trends-button" onClick={() => window.print()} disabled={!points.length}><Printer size={17} />Print graph</button></div>
    </div>
    {error ? <div className="glass-panel trends-message" role="alert"><p>Could not load trends: {error}</p><button className="trends-button" onClick={refresh}>Try again</button></div>
      : !data ? <div className="glass-panel trends-message" role="status">Loading snapshot history…</div>
        : !data.timeline.length || !data.trades.length ? <div className="glass-panel trends-message"><TrendingUp size={32} /><h2>No trend history yet</h2><p>Save a snapshot with trade scores to start tracking performance.</p></div>
          : <>
            <div className="glass-panel trends-controls">
              <div className="trends-fields">
                <label>Select trade<input type="search" className="glass-input" placeholder="Search trades…" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search trades" />
                  <select className="glass-input" value={trade.id} onChange={e => { setTradeId(e.target.value); setCategory(''); setComparisons(c => c.filter(id => id !== e.target.value)) }}>
                    {data.trades.filter(t => t.id === trade.id || t.name.toLowerCase().includes(search.toLowerCase())).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select></label>
                <label>Category benchmark<select className="glass-input" value={selectedCategory} onChange={e => setCategory(e.target.value)}>{categories.map(c => <option key={c}>{c}</option>)}</select></label>
                <label>Date range<select className="glass-input" value={range} onChange={e => setRange(e.target.value)}><option value="all">All snapshots</option><option value="8">Latest 8 snapshots</option><option value="12">Latest 12 snapshots</option><option value="24">Latest 24 snapshots</option></select></label>
              </div>
              <div className="trends-comparisons"><div><span className="trends-label">Compare trades</span><div className="trends-chips">
                {compareTrades.map((t, i) => <button key={t.id} className="trends-chip" style={{ color: COLORS[i + 1], borderColor: COLORS[i + 1] }} onClick={() => setComparisons(c => c.filter(id => id !== t.id))} aria-label={`Remove ${t.name}`} >{t.name}<X size={14} /></button>)}
                <select className="glass-input" aria-label="Add comparison trade" value="" disabled={compareTrades.length >= 5} onChange={e => { if (e.target.value) setComparisons(c => [...c, e.target.value]) }}>
                  <option value="">{compareTrades.length >= 5 ? '5 comparisons selected' : '+ Add trade'}</option>
                  {data.trades.filter(t => !ids.includes(t.id)).map(t => <option key={t.id} value={t.id}>{t.name} · {t.category}</option>)}
                </select>
              </div></div><label className="trends-toggle"><input type="checkbox" role="switch" checked={showAverage} onChange={e => setShowAverage(e.target.checked)} />Show category average</label></div>
            </div>
            <div className="trends-summary">
              <div className="glass-panel"><span>Latest score</span><strong>{number(latestScore)}</strong><small>{trade.name}{latest && ` · ${date(latest.created_at)}`}</small></div>
              <div className="glass-panel"><span>Since first snapshot</span><strong style={{ color: change < 0 ? '#dc5962' : 'var(--g-accent-2)' }}>{delta(change)}</strong><small>{scored.length > 1 ? `${date(scored[0].created_at)} – ${date(latest.created_at)}` : 'Two scored snapshots needed'}</small></div>
              <div className="glass-panel"><span>vs. category average</span><strong style={{ color: peerDifference < 0 ? '#dc5962' : 'var(--g-accent-2)' }}>{delta(peerDifference)}</strong><small>{selectedCategory} · same snapshot as latest score</small></div>
            </div>
            <div className="glass-panel trends-plot"><div className="trends-plot-heading"><div><h2>Score over time</h2><p>{points.length} snapshots{points.length > 0 && ` · ${date(points[0].created_at)} – ${date(points.at(-1).created_at)}`}</p></div><div className="trends-legend">{series.map(s => <span key={s.id}><i style={{ borderTop: `3px ${s.average ? 'dashed' : 'solid'} ${s.color}` }} />{s.name}</span>)}</div></div>
              {points.some(p => series.some(s => (s.average ? p.average : p.scores[s.id]) != null)) ? <TrendChart key={`${ids.join(',')}:${range}:${selectedCategory}:${showAverage}`} points={points} series={series} /> : <p className="trends-message">No scores available for this selection and date range.</p>}
              <p className="trends-footnote">Each point is a saved total score (0–100). Gaps indicate missing scores. Trade selections and category averages use only vendors with a current score on the Scores tab. The {selectedCategory} average uses their category assignments and available scores in each snapshot, including the selected trade when applicable.</p>
              <details className="trends-data"><summary>View snapshot values</summary><div className="trends-table-scroll"><table><thead><tr><th>Snapshot</th><th>Date</th>{series.map(s => <th key={s.id}>{s.name}</th>)}</tr></thead><tbody>{points.map(p => <tr key={p.id}><td>{p.name}</td><td>{date(p.created_at)}</td>{series.map(s => <td key={s.id}>{number(s.average ? p.average : p.scores[s.id])}</td>)}</tr>)}</tbody></table></div></details>
            </div>
          </>}
  </section>
}
