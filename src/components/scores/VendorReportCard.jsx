import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabase'
import { X, Printer } from 'lucide-react'
import { tierPillStyle, tierValueColor } from '../../lib/design/tokens'
import { formatJcVendorIds } from '../../lib/formatJcVendorIds'

const SEVERITY_BADGE = {
  kudos: 'bg-green-100 text-green-700',
  critical: 'bg-red-100 text-red-700',
  major: 'bg-orange-100 text-orange-700',
  minor: 'bg-yellow-100 text-yellow-700',
}

function fmt(v) {
  return v != null ? Number(v).toFixed(1) : '—'
}

function fmtCurrency(v) {
  if (v == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v)
}

/** Project abbreviation only — omit embedded marketing name (e.g. "HOUFM Avalon Ridge" → "HOUFM"). */
function communityAbbreviation(community) {
  const code = community?.code?.trim()
  if (!code) return null
  const name = community?.name?.trim()
  if (name && name !== code) return code
  const space = code.indexOf(' ')
  return space > 0 ? code.slice(0, space) : code
}

function ScoreBox({ label, value, getTier, large }) {
  const tier = getTier(value)
  return (
    <div
      className="rounded-lg border p-3 text-center"
      style={tier && tier.label !== 'No data'
        ? { background: tier.softBg, borderColor: 'transparent' }
        : { background: 'var(--g-panel-2)', borderColor: 'var(--g-line)' }}
    >
      <p
        className={`font-bold ${large ? 'text-2xl' : 'text-xl'}`}
        style={{ color: tier && tier.label !== 'No data' ? tierValueColor(tier) : 'var(--g-dim)' }}
      >
        {fmt(value)}
      </p>
      <p className="text-xs mt-0.5" style={{ color: 'var(--g-dim)' }}>{label}</p>
    </div>
  )
}

export default function VendorReportCard({ scoreRow, getTier, onClose }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let mounted = true
    const vendorId = scoreRow.vendor_id

    async function load() {
      setLoading(true)
      setLoadError('')
      setData(null)
      try {
        const [snapRes, feedRes, safeRes, rwRes, assignRes, brandRes] = await Promise.all([
          supabase
            .from('snapshot_score_results')
            .select('weighted_total, safety_score, schedule_score, rework_score, feedback_score, snapshots(name, created_at)')
            .eq('vendor_id', vendorId),
          supabase
            .from('builder_feedback')
            .select('category, severity, points, description, submitted_at, communities(name, code)')
            .eq('vendor_id', vendorId)
            .eq('is_approved', true)
            .order('submitted_at', { ascending: false })
            .limit(10),
          supabase
            .from('safety_records')
            .select('record_date, severity, severity_points, incident_type')
            .eq('vendor_id', vendorId)
            .order('record_date', { ascending: false })
            .limit(6),
          supabase
            .from('rework_records')
            .select('record_date, cost, severity, description')
            .eq('vendor_id', vendorId)
            .order('record_date', { ascending: false })
            .limit(6),
          supabase
            .from('vendor_community_assignments')
            .select('community_id, communities(name, code)')
            .eq('vendor_id', vendorId),
          supabase
            .from('vendor_brand_references')
            .select('brand, jc_vendor_id')
            .eq('vendor_id', vendorId),
        ])

        for (const res of [snapRes, feedRes, safeRes, rwRes, assignRes, brandRes]) {
          if (res.error) throw res.error
        }

        const communityCodeMap = new Map()
        for (const row of assignRes.data || []) {
          const abbrev = communityAbbreviation(row.communities)
          if (abbrev && row.community_id && !communityCodeMap.has(row.community_id)) {
            communityCodeMap.set(row.community_id, abbrev)
          }
        }
        const communityCodes = [...new Set(communityCodeMap.values())].sort((a, b) => a.localeCompare(b))

        const snapshots = (snapRes.data || [])
          .filter(s => s.snapshots?.created_at)
          .sort((a, b) => new Date(a.snapshots.created_at) - new Date(b.snapshots.created_at))

        if (mounted) {
          setData({
            snapshots,
            feedback: feedRes.data || [],
            safety: safeRes.data || [],
            rework: rwRes.data || [],
            communityCodes,
            brandRefs: brandRes.data || [],
          })
        }
      } catch (err) {
        console.error('VendorReportCard load error:', err)
        if (mounted) {
          setLoadError('Could not load report data. Please try again.')
          setData({ snapshots: [], feedback: [], safety: [], rework: [], communityCodes: [], brandRefs: [] })
        }
      } finally {
        if (mounted) setLoading(false)
      }
    }

    if (vendorId) load()
    else if (mounted) {
      setLoading(false)
      setData({ snapshots: [], feedback: [], safety: [], rework: [], communityCodes: [], brandRefs: [] })
    }

    return () => { mounted = false }
  }, [scoreRow.vendor_id])

  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  const vendorName = scoreRow.vendors?.name || 'Unknown Vendor'
  const category = scoreRow.vendors?.vendor_categories?.name || ''
  const tier = getTier(scoreRow.weighted_total)

  const SCORE_FIELDS = [
    { label: 'Safety', key: 'safety_score' },
    { label: 'Schedule', key: 'schedule_score' },
    { label: 'Rework', key: 'rework_score' },
    { label: 'Feedback', key: 'feedback_score' },
    { label: 'Total', key: 'weighted_total', large: true },
  ]

  return createPortal(
    <div className="report-card-print-root fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.65)' }}>
      <div className="report-card-inner bg-white rounded-xl w-full max-w-3xl flex flex-col shadow-2xl" style={{ maxHeight: '90vh' }}>

        {/* Modal controls — hidden on print */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 flex-shrink-0 no-print">
          <span className="text-sm font-semibold text-gray-700">Vendor Report Card</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-white rounded-lg"
              style={{ backgroundColor: '#087482' }}
            >
              <Printer className="w-4 h-4" />
              Print / Save PDF
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable area */}
        <div className="overflow-y-auto flex-1 report-card-scroll">
          {/* Printable content */}
          <div className="report-card-content p-8 space-y-6">

            {/* Header */}
            <div className="report-card-header flex items-start justify-between gap-6 pb-5 border-b-2" style={{ borderColor: '#087482' }}>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-1">
                  Vendor Performance Report
                </p>
                <h1 className="text-2xl font-bold text-gray-900">{vendorName}</h1>
                {category && <p className="text-sm text-gray-500 mt-0.5">{category}</p>}
                {formatJcVendorIds(data?.brandRefs) && (
                  <p className="text-sm text-gray-500 mt-0.5">
                    <span className="text-gray-600">Vendor ID:</span>{' '}
                    <span className="font-mono text-xs">{formatJcVendorIds(data.brandRefs)}</span>
                  </p>
                )}
                <p className="text-sm text-gray-500 mt-0.5">
                  {scoreRow.schedule_total_jobs ?? 0} job{(scoreRow.schedule_total_jobs ?? 0) === 1 ? '' : 's'} in score period
                </p>
                {data?.communityCodes?.length > 0 && (
                  <p className="text-sm text-gray-500 mt-1">
                    <span className="text-gray-600">Communities:</span>{' '}
                    <span className="font-mono text-xs">{data.communityCodes.join(' · ')}</span>
                  </p>
                )}
              </div>
              <div className="report-card-header-meta shrink-0 flex flex-col items-end gap-1.5 text-right">
                {tier && tier.label !== 'No data' && (
                  <div className="glass-tier-pill text-sm whitespace-nowrap" style={tierPillStyle(tier)}>
                    {tier.label}
                  </div>
                )}
                <p className="text-xs text-gray-400 leading-snug">
                  Generated {today}
                </p>
                <p className="text-xs text-gray-400 leading-snug">
                  VTC Scorecard
                </p>
              </div>
            </div>

            {/* Current scores */}
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">Current Scores</h2>
              <div className="grid grid-cols-5 gap-3 report-card-score-grid">
                {SCORE_FIELDS.map(({ label, key, large }) => (
                  <ScoreBox key={key} label={label} value={scoreRow[key]} getTier={getTier} large={large} />
                ))}
              </div>
            </div>

            {/* Risk (12mo) — display-only, not part of the weighted score above */}
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3 flex items-center gap-1.5 relative w-fit group">
                Risk (12mo)
                <span className="text-gray-300 cursor-help no-print">ⓘ</span>
                <div className="hidden group-hover:block absolute left-0 top-full mt-1 w-72 p-2.5 bg-white border border-gray-200 rounded-lg shadow-lg text-left text-xs font-normal normal-case text-gray-600 z-10 no-print">
                  Estimated 12-month $ exposure if this vendor continues at its current trend: rework backcharge admin overhead + OSHA-anchored safety costs + no-shows, scaled to a trend-adjusted job volume. Separate from the score above — does not affect it.
                </div>
              </h2>
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 report-card-risk">
                <div className="flex items-center justify-between mb-3 report-card-risk-top">
                  <p className="text-2xl font-bold text-red-700">{fmtCurrency(scoreRow.risk_exposure_12mo)}</p>
                  {scoreRow.risk_low_data && (
                    <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-0.5 report-card-risk-badge">
                      Limited schedule history — not yet annualized
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-3 text-xs text-gray-600 report-card-risk-details">
                  <p>{scoreRow.risk_rework_count} rework instance{scoreRow.risk_rework_count === 1 ? '' : 's'} → <span className="font-medium text-gray-800">{fmtCurrency(scoreRow.risk_rework_dollar)}</span></p>
                  <p>Safety incidents → <span className="font-medium text-gray-800">{fmtCurrency(scoreRow.risk_safety_dollar)}</span></p>
                  <p>{scoreRow.risk_noshow_count} no-show{scoreRow.risk_noshow_count === 1 ? '' : 's'} → <span className="font-medium text-gray-800">{fmtCurrency(scoreRow.risk_noshow_dollar)}</span></p>
                </div>
              </div>
            </div>

            {loading ? (
              <p className="text-sm text-gray-400 py-6 text-center">Loading report data…</p>
            ) : !data ? (
              <p className="text-sm text-gray-400 py-6 text-center">No report data available.</p>
            ) : (
              <>
                {loadError && (
                  <p className="text-sm text-red-600 py-2 text-center">{loadError}</p>
                )}
                {/* Snapshot history */}
                {data.snapshots.length > 0 && (
                  <div>
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
                      Score History — {data.snapshots.length} Snapshot{data.snapshots.length !== 1 ? 's' : ''}
                    </h2>
                    <div className="overflow-x-auto report-card-table-wrap">
                      <table className="w-full text-sm border border-gray-200 rounded-lg overflow-hidden report-card-table">
                        <thead>
                          <tr className="bg-gray-50 text-left">
                            <th className="px-4 py-2 font-medium text-gray-600">Snapshot</th>
                            <th className="px-4 py-2 font-medium text-gray-600">Date</th>
                            <th className="px-4 py-2 text-right font-medium text-gray-600">Safety</th>
                            <th className="px-4 py-2 text-right font-medium text-gray-600">Schedule</th>
                            <th className="px-4 py-2 text-right font-medium text-gray-600">Rework</th>
                            <th className="px-4 py-2 text-right font-medium text-gray-600">Feedback</th>
                            <th className="px-4 py-2 text-right font-medium text-gray-600">Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {data.snapshots.map((s, i) => {
                            const prev = i > 0 ? data.snapshots[i - 1].weighted_total : null
                            const delta = prev != null && s.weighted_total != null
                              ? Number(s.weighted_total) - Number(prev)
                              : null
                            return (
                              <tr key={i} className="hover:bg-gray-50">
                                <td className="px-4 py-2 font-medium text-gray-800">{s.snapshots?.name || '—'}</td>
                                <td className="px-4 py-2 text-xs text-gray-500">
                                  {new Date(s.snapshots.created_at).toLocaleDateString()}
                                </td>
                                <td className="px-4 py-2 text-right font-mono text-gray-700">{fmt(s.safety_score)}</td>
                                <td className="px-4 py-2 text-right font-mono text-gray-700">{fmt(s.schedule_score)}</td>
                                <td className="px-4 py-2 text-right font-mono text-gray-700">{fmt(s.rework_score)}</td>
                                <td className="px-4 py-2 text-right font-mono text-gray-700">{fmt(s.feedback_score)}</td>
                                <td className="px-4 py-2 text-right font-mono font-bold text-gray-900">
                                  {fmt(s.weighted_total)}
                                  {delta !== null && (
                                    <span
                                      className={`ml-1.5 text-xs font-medium ${delta > 0 ? 'text-green-600' : delta < 0 ? 'text-red-600' : 'text-gray-400'}`}
                                    >
                                      {delta > 0 ? '+' : ''}{delta.toFixed(1)}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Feedback */}
                {data.feedback.length > 0 && (
                  <div>
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
                      Recent Approved Feedback
                    </h2>
                    <div className="space-y-2">
                      {data.feedback.map((f, i) => {
                        const badgeKey = f.category === 'kudos' ? 'kudos' : (f.severity || 'minor')
                        const label = f.category === 'kudos'
                          ? 'Kudos'
                          : `${(f.severity || '').charAt(0).toUpperCase() + (f.severity || '').slice(1)} Complaint`
                        const communityCode = communityAbbreviation(f.communities)
                        return (
                          <div key={i} className="border border-gray-200 rounded-lg p-3">
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`text-xs px-2 py-0.5 rounded font-medium ${SEVERITY_BADGE[badgeKey] || 'bg-gray-100 text-gray-600'}`}>
                                  {label}
                                </span>
                                <span className="text-xs font-mono text-gray-500">{f.points} pts</span>
                                {communityCode && (
                                  <span className="text-xs font-mono text-gray-400">{communityCode}</span>
                                )}
                              </div>
                              <span className="text-xs text-gray-400 whitespace-nowrap">
                                {new Date(f.submitted_at).toLocaleDateString()}
                              </span>
                            </div>
                            <p className="text-xs text-gray-600 leading-relaxed">{f.description}</p>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Safety + Rework */}
                {(data.safety.length > 0 || data.rework.length > 0) && (
                  <div className="grid grid-cols-2 gap-6 report-card-incidents">
                    {data.safety.length > 0 && (
                      <div>
                        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
                          Safety Incidents
                        </h2>
                        <div className="space-y-1.5">
                          {data.safety.map((s, i) => (
                            <div key={i} className="text-xs border border-red-200 rounded p-2.5 bg-red-50">
                              <div className="flex items-center justify-between mb-0.5">
                                <span className="font-semibold text-gray-800 capitalize">{s.severity}</span>
                                <span className="font-mono text-gray-500">{s.record_date}</span>
                              </div>
                              {s.incident_type && <p className="text-gray-600">{s.incident_type}</p>}
                              <p className="text-red-700 font-medium">{s.severity_points} pts deducted</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {data.rework.length > 0 && (
                      <div>
                        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
                          Rework / Backcharges
                        </h2>
                        <div className="space-y-1.5">
                          {data.rework.map((r, i) => (
                            <div key={i} className="text-xs border border-orange-200 rounded p-2.5 bg-orange-50">
                              <div className="flex items-center justify-between mb-0.5">
                                <span className="font-semibold text-gray-800">
                                  ${Number(r.cost || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                                <span className="font-mono text-gray-500">{r.record_date}</span>
                              </div>
                              <p className="text-orange-700 capitalize">{r.severity}</p>
                              {r.description && <p className="text-gray-600 mt-0.5">{r.description}</p>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Empty state */}
                {data.snapshots.length === 0 && data.feedback.length === 0 &&
                 data.safety.length === 0 && data.rework.length === 0 && (
                  <p className="text-sm text-gray-400 text-center py-4">
                    No historical data on file for this vendor yet.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
