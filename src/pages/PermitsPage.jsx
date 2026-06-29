import { useState, useMemo, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { logActivity } from '../hooks/useActivityLog'
import { usePermitData } from '../hooks/usePermitData'
import { parsePermitFile } from '../lib/parsers/permit-parser'
import {
  monthRange, computeForecast, aggregatePeriods, detectAnomalies, formatMonthShort,
} from '../lib/permit-forecast'
import {
  TrendingUp, TrendingDown, Upload, Loader2, CheckCircle, AlertTriangle,
  Activity, Search, Zap, ChevronDown,
} from 'lucide-react'

const CHUNK = 500
const LS_KEY = 'permitPulse.filters'
const SIGMA_OPTIONS = [1.5, 2, 2.5]

// anomaly palette
const C_HIGH = { bar: '#d97b16', text: '#8a5a08', soft: '#f8ecc9' }   // surge
const C_LOW = { bar: '#d44848', text: '#a72727', soft: '#f8dada' }    // slowdown
const C_OK = { text: '#15803d', soft: '#dcf2e4' }

function pct(v, digits = 1) {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(digits)}%`
}
function num(v) { return (v ?? 0).toLocaleString() }

function loadFilters() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return { regions: [], builders: [], granularity: 'monthly', sigma: 2 }
}

// ---- series helpers ----
function sumByMonth(records) {
  const m = new Map()
  for (const r of records) m.set(r.period_month, (m.get(r.period_month) || 0) + r.permits)
  return m
}
function denseFromMap(map, first, last) {
  if (!first || !last) return []
  return monthRange(first, last).map(month => ({ month, permits: map.get(month) || 0 }))
}

/**
 * Build the monthly actuals for the current filter, picking the source that
 * gives the most history for that filter combination:
 *   no region + no builder  -> citywide total           (full ~24 mo)
 *   no region + builders     -> peer builders, citywide  (full ~24 mo)
 *   regions   + no builder   -> regions, all builders     (full ~24 mo)
 *   regions   + builders     -> crossed region×builder    (~12 mo, top builders)
 */
function buildFilteredSeries({ rows, rbRows, regions, builders, marginalBounds, rbBounds }) {
  const regSet = new Set(regions), bldSet = new Set(builders)
  const useReg = regions.length > 0, useBld = builders.length > 0

  if (useReg && useBld) {
    const recs = rbRows.filter(r => regSet.has(r.region) && bldSet.has(r.builder))
    return {
      actuals: denseFromMap(sumByMonth(recs), rbBounds?.first, rbBounds?.last),
      crossed: true, empty: recs.length === 0,
      label: `${builders.length} builder${builders.length > 1 ? 's' : ''} × ${regions.length} region${regions.length > 1 ? 's' : ''}`,
    }
  }
  if (useBld) {
    const recs = rows.filter(r => r.scope_type === 'builder' && bldSet.has(r.scope_name))
    return {
      actuals: denseFromMap(sumByMonth(recs), marginalBounds?.first, marginalBounds?.last),
      crossed: false, empty: recs.length === 0,
      label: `${builders.length} peer builder${builders.length > 1 ? 's' : ''}, citywide`,
    }
  }
  if (useReg) {
    const recs = rows.filter(r => r.scope_type === 'region' && regSet.has(r.scope_name))
    return {
      actuals: denseFromMap(sumByMonth(recs), marginalBounds?.first, marginalBounds?.last),
      crossed: false, empty: recs.length === 0,
      label: `${regions.length} region${regions.length > 1 ? 's' : ''}, all builders`,
    }
  }
  const recs = rows.filter(r => r.scope_type === 'total')
  return {
    actuals: denseFromMap(sumByMonth(recs), marginalBounds?.first, marginalBounds?.last),
    crossed: false, empty: recs.length === 0, label: 'Whole market',
  }
}

// ---- chart: actuals + forecast tail + ±σ normal band, anomaly points colored ----
function PulseChart({ periods, band }) {
  const W = 820, H = 240, PAD_L = 44, PAD_R = 16, PAD_T = 16, PAD_B = 30
  if (!periods.length) return null
  const innerW = W - PAD_L - PAD_R
  const innerH = H - PAD_T - PAD_B
  const vals = periods.map(p => p.permits)
  const hi = Math.max(1, ...vals, band ? band.hi : 0)
  const x = (i) => PAD_L + (periods.length === 1 ? 0 : (i / (periods.length - 1)) * innerW)
  const y = (v) => PAD_T + innerH - (Math.max(0, v) / hi) * innerH

  const splitIdx = periods.findIndex(p => p.forecast)
  const lastActualIdx = splitIdx === -1 ? periods.length - 1 : splitIdx - 1
  const actualPts = periods.filter(p => !p.forecast).map((p, i) => `${x(i)},${y(p.permits)}`).join(' ')
  const fc = periods.filter(p => p.forecast)
  const forecastPts = fc.length
    ? `${x(lastActualIdx)},${y(periods[lastActualIdx].permits)} ` +
      fc.map((p, i) => `${x(lastActualIdx + 1 + i)},${y(p.permits)}`).join(' ')
    : ''
  const ticks = [0, Math.round(hi / 2), hi]
  const dotColor = (s) => s === 'high' ? C_HIGH.bar : s === 'low' ? C_LOW.bar : 'var(--g-accent)'

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 260 }}>
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={PAD_L} y1={y(t)} x2={W - PAD_R} y2={y(t)} stroke="var(--g-line)" strokeWidth="1" />
          <text x={PAD_L - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="var(--g-dim)">{t}</text>
        </g>
      ))}
      {/* normal range band */}
      {band && (
        <>
          <rect x={PAD_L} y={y(band.hi)} width={innerW} height={Math.max(0, y(band.lo) - y(band.hi))}
            fill="var(--g-accent)" opacity="0.08" />
          <line x1={PAD_L} y1={y(band.mean)} x2={W - PAD_R} y2={y(band.mean)}
            stroke="var(--g-dim)" strokeWidth="1" strokeDasharray="2 3" opacity="0.7" />
        </>
      )}
      {/* forecast region shade */}
      {fc.length > 0 && (
        <rect x={x(lastActualIdx)} y={PAD_T} width={W - PAD_R - x(lastActualIdx)} height={innerH}
          fill="var(--g-dim)" opacity="0.05" />
      )}
      <polyline points={actualPts} fill="none" stroke="var(--g-accent)" strokeWidth="2"
        strokeLinejoin="round" strokeLinecap="round" />
      {forecastPts && (
        <polyline points={forecastPts} fill="none" stroke="var(--g-accent)" strokeWidth="2"
          strokeDasharray="5 4" opacity="0.55" strokeLinejoin="round" strokeLinecap="round" />
      )}
      {/* points (anomalies emphasized) */}
      {periods.map((p, i) => p.forecast ? null : (
        <circle key={i} cx={x(i)} cy={y(p.permits)} r={p.status === 'normal' ? 2 : 4}
          fill={dotColor(p.status)} stroke="var(--g-panel)" strokeWidth={p.status === 'normal' ? 0 : 1.5} />
      ))}
      {[0, lastActualIdx, periods.length - 1].map((i, k) => (
        <text key={k} x={x(i)} y={H - 8} textAnchor={k === 0 ? 'start' : k === 2 ? 'end' : 'middle'}
          fontSize="10" fill="var(--g-dim)">{periods[i].label}</text>
      ))}
    </svg>
  )
}

function MetricCard({ label, value, sub, trend }) {
  const up = trend != null && trend >= 0
  return (
    <div className="glass-panel p-4">
      <p className="text-xs font-medium" style={{ color: 'var(--g-dim)' }}>{label}</p>
      <p className="text-2xl font-bold mt-1" style={{ color: 'var(--g-text)' }}>{value}</p>
      {sub != null && (
        <p className="text-xs mt-1 flex items-center gap-1"
          style={{ color: trend == null ? 'var(--g-dim)' : up ? C_OK.text : C_LOW.text }}>
          {trend != null && (up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />)}
          {sub}
        </p>
      )}
    </div>
  )
}

export default function PermitsPage() {
  const { user, isManager } = useAuth()
  const canUpload = isManager()
  const { importMeta, rows, rbRows, loading, error, refresh } = usePermitData()

  const init = loadFilters()
  const [regions, setRegions] = useState(init.regions || [])
  const [builders, setBuilders] = useState(init.builders || [])
  const [granularity, setGranularity] = useState(init.granularity || 'monthly')
  const [sigma, setSigma] = useState(init.sigma || 2)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [search, setSearch] = useState('')

  // upload state
  const [file, setFile] = useState(null)
  const [parsing, setParsing] = useState(false)
  const [preview, setPreview] = useState(null)
  const [saving, setSaving] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [progress, setProgress] = useState('')

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ regions, builders, granularity, sigma })) } catch { /* ignore */ }
  }, [regions, builders, granularity, sigma])

  const marginalBounds = useMemo(() => {
    const ms = rows.map(r => r.period_month).sort()
    return ms.length ? { first: ms[0], last: ms[ms.length - 1] } : null
  }, [rows])
  const rbBounds = useMemo(() => {
    const ms = rbRows.map(r => r.period_month).sort()
    return ms.length ? { first: ms[0], last: ms[ms.length - 1] } : null
  }, [rbRows])

  const regionNames = useMemo(
    () => [...new Set(rows.filter(r => r.scope_type === 'region').map(r => r.scope_name))].sort(),
    [rows]
  )

  // builder list for the picker, ranked by trailing-12 volume
  const builderList = useMemo(() => {
    if (!marginalBounds) return []
    const last12 = monthRange(marginalBounds.first, marginalBounds.last).slice(-12)
    const set = new Set(last12)
    const totals = new Map()
    for (const r of rows) {
      if (r.scope_type !== 'builder') continue
      if (!set.has(r.period_month)) continue
      totals.set(r.scope_name, (totals.get(r.scope_name) || 0) + r.permits)
    }
    return [...totals.entries()].map(([name, t12]) => ({ name, t12 })).sort((a, b) => b.t12 - a.t12)
  }, [rows, marginalBounds])

  const filtered = useMemo(
    () => buildFilteredSeries({ rows, rbRows, regions, builders, marginalBounds, rbBounds }),
    [rows, rbRows, regions, builders, marginalBounds, rbBounds]
  )

  const forecast = useMemo(
    () => (filtered.actuals.length ? computeForecast(filtered.actuals) : null),
    [filtered]
  )

  // periods at chosen granularity + forecast tail aggregated the same way
  const chartPeriods = useMemo(() => {
    if (!filtered.actuals.length) return []
    const actualP = aggregatePeriods(filtered.actuals, granularity).map(p => ({ ...p, forecast: false }))
    let fcP = []
    if (forecast) {
      const fcMonthly = forecast.forecast.map(f => ({ month: f.month, permits: f.permits }))
      const lastKey = actualP[actualP.length - 1]?.period
      fcP = aggregatePeriods(fcMonthly, granularity)
        .filter(p => p.period > lastKey)
        .map(p => ({ ...p, forecast: true, status: 'normal' }))
    }
    return [...actualP, ...fcP]
  }, [filtered, granularity, forecast])

  const anomaly = useMemo(() => {
    const actualP = chartPeriods.filter(p => !p.forecast)
    return detectAnomalies(actualP, { sigma })
  }, [chartPeriods, sigma])

  // merge anomaly status back onto the chart periods
  const decoratedPeriods = useMemo(() => {
    if (!anomaly) return chartPeriods
    const byKey = new Map(anomaly.periods.map(p => [p.period, p.status]))
    return chartPeriods.map(p => p.forecast ? p : { ...p, status: byKey.get(p.period) || 'normal' })
  }, [chartPeriods, anomaly])

  // builder breakdown within the active region filter (the actionable peer list)
  const builderBreakdown = useMemo(() => {
    const useReg = regions.length > 0
    const totals = new Map()
    if (useReg) {
      const regSet = new Set(regions)
      for (const r of rbRows) { if (regSet.has(r.region)) totals.set(r.builder, (totals.get(r.builder) || 0) + r.permits) }
    } else if (marginalBounds) {
      const last12 = new Set(monthRange(marginalBounds.first, marginalBounds.last).slice(-12))
      for (const r of rows) { if (r.scope_type === 'builder' && last12.has(r.period_month)) totals.set(r.scope_name, (totals.get(r.scope_name) || 0) + r.permits) }
    }
    return [...totals.entries()].map(([name, v]) => ({ name, v })).sort((a, b) => b.v - a.v)
  }, [rows, rbRows, regions, marginalBounds])

  function toggle(list, setList, value) {
    setList(list.includes(value) ? list.filter(v => v !== value) : [...list, value])
  }

  async function handleParse(f) {
    if (!f) return
    setFile(f); setParsing(true); setUploadError(''); setPreview(null)
    try { setPreview(await parsePermitFile(f)) }
    catch (err) { setUploadError(err.message) }
    finally { setParsing(false) }
  }

  async function handleSave() {
    if (!preview || !file) return
    setSaving(true); setUploadError('')
    try {
      setProgress('Creating import record...')
      const sourceLabel = file.name.replace(/\.(csv|xlsx?)$/i, '')
      const { data: imp, error: impErr } = await supabase.from('permit_imports').insert({
        original_filename: file.name, source_label: sourceLabel,
        report_month: preview.reportMonth, first_month: preview.firstMonth,
        row_count: preview.rowCount, month_count: preview.months.length, uploaded_by: user.id,
      }).select().single()
      if (impErr) throw new Error('Import record failed: ' + impErr.message)

      const marginal = preview.series.map(s => ({ ...s, import_id: imp.id }))
      for (let i = 0; i < marginal.length; i += CHUNK) {
        setProgress(`Saving series ${i + 1}–${Math.min(i + CHUNK, marginal.length)} of ${marginal.length}...`)
        const { error: e } = await supabase.from('permit_series').insert(marginal.slice(i, i + CHUNK))
        if (e) throw new Error('Series insert failed: ' + e.message)
      }
      const rb = (preview.rbSeries || []).map(s => ({ ...s, import_id: imp.id }))
      for (let i = 0; i < rb.length; i += CHUNK) {
        setProgress(`Saving region×builder ${i + 1}–${Math.min(i + CHUNK, rb.length)} of ${rb.length}...`)
        const { error: e } = await supabase.from('permit_rb_series').insert(rb.slice(i, i + CHUNK))
        if (e) throw new Error('Region/builder insert failed: ' + e.message)
      }

      await logActivity('permit_import',
        `Imported permit data: ${file.name} (through ${formatMonthShort(preview.reportMonth)}, ${preview.rowCount} + ${rb.length} rows)`,
        { import_id: imp.id, report_month: preview.reportMonth, counts: preview.counts })

      setFile(null); setPreview(null); setProgress('')
      await refresh()
    } catch (err) { setUploadError(err.message) }
    finally { setSaving(false) }
  }

  if (loading) return <div className="flex justify-center py-20"><div className="app-loading-spinner" /></div>

  const hasData = !!importMeta && rows.length > 0
  const filteredBuilders = search
    ? builderList.filter(b => b.name.toLowerCase().includes(search.toLowerCase()))
    : builderList

  // anomaly banner content
  let banner = null
  if (anomaly?.latest) {
    const L = anomaly.latest
    if (L.status === 'high') banner = { c: C_HIGH, icon: Zap, title: `Surge — ${L.label} ran ${pct((L.permits - anomaly.mean) / anomaly.mean, 0)} above normal (+${L.z.toFixed(1)}σ)`, body: 'More work is coming than your trades are staffed for. Book additional capacity now — at this pace crews get stretched and walk to busier sites.' }
    else if (L.status === 'low') banner = { c: C_LOW, icon: TrendingDown, title: `Slowdown — ${L.label} ran ${pct((L.permits - anomaly.mean) / anomaly.mean, 0)} below normal (${L.z.toFixed(1)}σ)`, body: 'Demand for this slice is dropping. Renegotiate or claw back trade commitments before the gap lands on site in 1–2 months.' }
    else banner = { c: C_OK, icon: Activity, title: `Within normal range — ${L.label}: ${num(L.permits)} starts (${L.z >= 0 ? '+' : ''}${L.z.toFixed(1)}σ)`, body: 'No action needed; permit starts for this slice are tracking their usual range.' }
  }

  return (
    <div className="space-y-6 min-w-0">
      <div>
        <h1 className="glass-page-title flex items-center gap-2"><Activity className="w-6 h-6" /> Permit Pulse</h1>
        <p className="glass-page-subtitle">
          Permit starts as an early-warning signal for trade-base capacity.
          {importMeta && <> Latest file <strong>{importMeta.source_label || importMeta.original_filename}</strong>, data through {formatMonthShort(importMeta.report_month)}.</>}
          {' '}Files arrive ~10th monthly with a one-month reporting lag — still well ahead of typical start dates.
        </p>
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}

      {/* Upload */}
      {canUpload && (
        <div className="glass-panel p-5">
          <h2 className="glass-section-title mb-3">Add monthly permit file</h2>
          {!preview ? (
            <div
              onDrop={e => { e.preventDefault(); handleParse(e.dataTransfer?.files?.[0]) }}
              onDragOver={e => e.preventDefault()}
              className="border-2 border-dashed rounded-xl p-8 text-center cursor-pointer"
              style={{ borderColor: 'var(--g-line)' }}>
              <input type="file" accept=".csv,.xls,.xlsx" className="hidden" id="permit-file"
                onChange={e => handleParse(e.target.files?.[0])} />
              <label htmlFor="permit-file" className="cursor-pointer">
                {parsing ? <Loader2 className="w-8 h-8 mx-auto mb-2 animate-spin" style={{ color: 'var(--g-dim)' }} />
                  : <Upload className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--g-dim)' }} />}
                <p className="text-sm" style={{ color: 'var(--g-dim)' }}>
                  {parsing ? 'Reading workbook...' : 'Drop the monthly HPermits file (.xlsx/.csv), or click to browse'}
                </p>
              </label>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <MetricCard label="Through" value={formatMonthShort(preview.reportMonth)} />
                <MetricCard label="Months" value={preview.months.length} />
                <MetricCard label="Regions" value={preview.counts.region} />
                <MetricCard label="Builders" value={preview.counts.builder} />
                <MetricCard label="Region×Builder" value={num(preview.counts.crossedRows)} />
              </div>
              <p className="text-xs" style={{ color: 'var(--g-dim)' }}>{preview.rowCount.toLocaleString()} series + {num(preview.counts.crossedRows)} crossed rows · {file?.name}</p>
              {progress && <p className="text-sm flex items-center gap-2" style={{ color: 'var(--g-accent)' }}><Loader2 className="w-4 h-4 animate-spin" /> {progress}</p>}
              <div className="flex gap-3">
                <button onClick={() => { setPreview(null); setFile(null); setUploadError('') }}
                  className="px-4 py-2 text-sm rounded-lg border" style={{ borderColor: 'var(--g-line)' }}>Cancel</button>
                <button onClick={handleSave} disabled={saving} className="glass-btn-primary flex items-center gap-2 disabled:opacity-50">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                  {saving ? 'Saving...' : 'Save Import'}
                </button>
              </div>
            </div>
          )}
          {uploadError && (
            <div className="mt-3 p-3 rounded-lg flex items-start gap-2 text-sm bg-red-50 border border-red-200 text-red-700">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> <span className="font-mono">{uploadError}</span>
            </div>
          )}
        </div>
      )}

      {!hasData ? (
        <div className="glass-panel p-10 text-center">
          <Activity className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--g-dim)' }} />
          <p className="text-sm" style={{ color: 'var(--g-dim)' }}>
            No permit data yet.{canUpload ? ' Upload the monthly HPermits file above to get started.' : ' Ask an admin or manager to upload the monthly permit file.'}
          </p>
        </div>
      ) : (
        <>
          {/* Filter bar */}
          <div className="glass-panel p-5 space-y-4">
            {/* regions */}
            <div>
              <p className="text-xs font-medium mb-2" style={{ color: 'var(--g-dim)' }}>Regions</p>
              <div className="flex flex-wrap gap-1.5">
                <button onClick={() => setRegions([])}
                  className={`text-xs px-2.5 py-1 rounded-full border ${regions.length === 0 ? 'glass-nav-active border-transparent' : ''}`}
                  style={regions.length === 0 ? {} : { borderColor: 'var(--g-line)', color: 'var(--g-dim)' }}>All regions</button>
                {regionNames.map(r => {
                  const on = regions.includes(r)
                  return (
                    <button key={r} onClick={() => toggle(regions, setRegions, r)}
                      className={`text-xs px-2.5 py-1 rounded-full border ${on ? 'glass-nav-active border-transparent' : ''}`}
                      style={on ? {} : { borderColor: 'var(--g-line)', color: 'var(--g-text)' }}>{r}</button>
                  )
                })}
              </div>
            </div>

            {/* builders + granularity + sensitivity */}
            <div className="flex flex-wrap items-end gap-4">
              <div className="relative">
                <p className="text-xs font-medium mb-2" style={{ color: 'var(--g-dim)' }}>Peer builders <span className="opacity-70">(your product type — filters out custom/high-end noise)</span></p>
                <button onClick={() => setPickerOpen(o => !o)}
                  className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg border" style={{ borderColor: 'var(--g-line)' }}>
                  {builders.length ? `${builders.length} selected` : 'All builders'}
                  <ChevronDown className="w-4 h-4" style={{ color: 'var(--g-dim)' }} />
                </button>
                {pickerOpen && (
                  <div className="absolute z-20 mt-1 w-80 rounded-xl border shadow-lg p-3 space-y-2"
                    style={{ background: 'var(--g-panel-2)', borderColor: 'var(--g-line)' }}>
                    <div className="flex items-center gap-2 px-2 py-1 rounded-lg border" style={{ borderColor: 'var(--g-line)' }}>
                      <Search className="w-3.5 h-3.5" style={{ color: 'var(--g-dim)' }} />
                      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search builders…"
                        className="bg-transparent text-sm outline-none flex-1" style={{ color: 'var(--g-text)' }} />
                      {builders.length > 0 && <button onClick={() => setBuilders([])} className="text-xs" style={{ color: 'var(--g-accent)' }}>Clear</button>}
                    </div>
                    <div className="max-h-60 overflow-y-auto space-y-0.5">
                      {filteredBuilders.slice(0, 60).map(b => {
                        const on = builders.includes(b.name)
                        return (
                          <label key={b.name} className="flex items-center gap-2 px-2 py-1 text-sm rounded-lg cursor-pointer hover:opacity-80"
                            style={{ color: 'var(--g-text)' }}>
                            <input type="checkbox" checked={on} onChange={() => toggle(builders, setBuilders, b.name)} />
                            <span className="flex-1 truncate">{b.name}</span>
                            <span className="text-xs" style={{ color: 'var(--g-dim)' }}>{num(b.t12)}</span>
                          </label>
                        )
                      })}
                      {filteredBuilders.length === 0 && <p className="text-xs px-2 py-2" style={{ color: 'var(--g-dim)' }}>No matches.</p>}
                    </div>
                  </div>
                )}
              </div>

              <div>
                <p className="text-xs font-medium mb-2" style={{ color: 'var(--g-dim)' }}>View</p>
                <div className="flex gap-1">
                  {['monthly', 'quarterly'].map(g => (
                    <button key={g} onClick={() => setGranularity(g)}
                      className={`text-sm px-3 py-2 rounded-lg capitalize ${granularity === g ? 'glass-nav-active' : 'glass-nav-item'}`}>{g}</button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-medium mb-2" style={{ color: 'var(--g-dim)' }}>Sensitivity</p>
                <select value={sigma} onChange={e => setSigma(Number(e.target.value))}
                  className="text-sm px-3 py-2 rounded-lg border bg-transparent" style={{ borderColor: 'var(--g-line)', color: 'var(--g-text)' }}>
                  {SIGMA_OPTIONS.map(s => <option key={s} value={s}>±{s}σ</option>)}
                </select>
              </div>
            </div>

            <p className="text-xs" style={{ color: 'var(--g-dim)' }}>
              Showing <strong style={{ color: 'var(--g-text)' }}>{filtered.label}</strong>
              {filtered.crossed
                ? ` · region×builder slice (top builders, ${chartPeriods.filter(p => !p.forecast).length} ${granularity === 'quarterly' ? 'quarters' : 'months'})`
                : ` · full history (${chartPeriods.filter(p => !p.forecast).length} ${granularity === 'quarterly' ? 'quarters' : 'months'})`}
            </p>
          </div>

          {filtered.empty ? (
            <div className="glass-panel p-8 text-center text-sm" style={{ color: 'var(--g-dim)' }}>
              No permits for this region × builder combination in the current file. Try fewer builders or different regions.
            </div>
          ) : (
            <>
              {/* Anomaly banner */}
              {banner && (
                <div className="rounded-xl p-4 flex items-start gap-3" style={{ background: banner.c.soft }}>
                  <banner.icon className="w-5 h-5 shrink-0 mt-0.5" style={{ color: banner.c.bar || banner.c.text }} />
                  <div>
                    <p className="text-sm font-semibold" style={{ color: banner.c.text }}>{banner.title}</p>
                    <p className="text-xs mt-0.5" style={{ color: banner.c.text }}>{banner.body}</p>
                  </div>
                </div>
              )}
              {!anomaly && (
                <p className="text-xs flex items-center gap-1.5" style={{ color: 'var(--g-dim)' }}>
                  <AlertTriangle className="w-3.5 h-3.5" /> Not enough complete {granularity === 'quarterly' ? 'quarters' : 'months'} yet for a deviation signal (need ≥4). Try the monthly view or wait for more history to accumulate.
                </p>
              )}

              {/* KPIs */}
              {forecast && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <MetricCard label={filtered.crossed ? 'Last 12 mo' : 'Trailing 12 mo'} value={num(forecast.trailing12)}
                    sub={forecast.yoyPct != null ? `${pct(forecast.yoyPct)} vs prior year` : 'no prior-year data yet'} trend={forecast.yoyPct} />
                  <MetricCard label="Forecast next 12 mo" value={num(forecast.forecast.reduce((s, x) => s + x.permits, 0))}
                    sub={`momentum ×${forecast.momentum.toFixed(2)}`} trend={forecast.momentum - 1} />
                  <MetricCard label="Avg / month" value={num(Math.round(forecast.trailing12 / 12))} />
                  <MetricCard label={`Latest ${granularity === 'quarterly' ? 'quarter' : 'month'}`}
                    value={anomaly?.latest ? num(anomaly.latest.permits) : '—'}
                    sub={anomaly?.latest ? `${anomaly.latest.z >= 0 ? '+' : ''}${anomaly.latest.z.toFixed(1)}σ vs normal` : null}
                    trend={anomaly?.latest ? anomaly.latest.z : null} />
                </div>
              )}

              {/* Chart */}
              <div className="glass-panel p-5">
                <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                  <h2 className="glass-section-title">Permit starts — {granularity}</h2>
                  <span className="text-xs flex items-center gap-3 flex-wrap" style={{ color: 'var(--g-dim)' }}>
                    <span className="flex items-center gap-1"><span className="inline-block w-4 h-0.5" style={{ background: 'var(--g-accent)' }} /> actual</span>
                    <span className="flex items-center gap-1"><span className="inline-block w-4 h-0.5" style={{ background: 'var(--g-accent)', opacity: 0.55 }} /> forecast</span>
                    <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: 'var(--g-accent)', opacity: 0.15 }} /> normal range (±{sigma}σ)</span>
                    <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full" style={{ background: C_HIGH.bar }} /> surge</span>
                    <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full" style={{ background: C_LOW.bar }} /> drop</span>
                  </span>
                </div>
                <PulseChart periods={decoratedPeriods} band={anomaly?.band ? { ...anomaly.band, mean: anomaly.mean } : null} />
              </div>

              {/* Builder breakdown */}
              <div className="glass-panel p-5">
                <h2 className="glass-section-title mb-3">
                  Builders {regions.length ? `in ${regions.length} selected region${regions.length > 1 ? 's' : ''}` : '(citywide, trailing 12 mo)'}
                  <span className="text-xs font-normal ml-2" style={{ color: 'var(--g-dim)' }}>click to add/remove from your peer group</span>
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs" style={{ color: 'var(--g-dim)' }}>
                        <th className="py-2 pr-3 w-8"></th><th className="py-2 pr-3">#</th>
                        <th className="py-2 pr-3">Builder</th><th className="py-2 pr-3 text-right">Permits</th>
                      </tr>
                    </thead>
                    <tbody>
                      {builderBreakdown.slice(0, 30).map((b, i) => {
                        const on = builders.includes(b.name)
                        return (
                          <tr key={b.name} onClick={() => toggle(builders, setBuilders, b.name)}
                            className="cursor-pointer border-t" style={{ borderColor: 'var(--g-line)', background: on ? 'var(--g-panel-2)' : 'transparent' }}>
                            <td className="py-2 pr-3"><input type="checkbox" readOnly checked={on} /></td>
                            <td className="py-2 pr-3" style={{ color: 'var(--g-dim)' }}>{i + 1}</td>
                            <td className="py-2 pr-3 font-medium" style={{ color: 'var(--g-text)' }}>{b.name}</td>
                            <td className="py-2 pr-3 text-right">{num(b.v)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  {builderBreakdown.length > 30 && <p className="text-xs mt-2" style={{ color: 'var(--g-dim)' }}>Showing top 30 of {builderBreakdown.length}.</p>}
                </div>
              </div>
            </>
          )}

          <p className="text-xs" style={{ color: 'var(--g-dim)' }}>
            Deviation = each {granularity === 'quarterly' ? 'quarter' : 'month'} vs the mean of prior complete periods for this exact filter; ±{sigma}σ marks the normal band. A permit pulled now becomes trade work over the following ~6–9 months, so a surge or drop here is a 1–2 month lead on site demand. Region×builder slices cover the production "top builder" set and currently span ~12 months, lengthening as monthly files accumulate.
          </p>
        </>
      )}
    </div>
  )
}
