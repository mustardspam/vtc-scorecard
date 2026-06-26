import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useThresholds } from '../hooks/useThresholds'
import { tierPillStyle, tierValueColor } from '../lib/design/tokens'
import TierBadge from '../components/scores/TierBadge'
import { MapPin, ThumbsUp, ThumbsDown, Users, Building2 } from 'lucide-react'

export default function CommunityPage() {
  const [communities, setCommunities] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [vendorRows, setVendorRows] = useState([])
  const [feedbackStats, setFeedbackStats] = useState([])
  const [loading, setLoading] = useState(false)
  const [loadingCommunities, setLoadingCommunities] = useState(true)
  const { getTier } = useThresholds()

  useEffect(() => {
    let mounted = true
    supabase
      .from('communities')
      .select('id, name, code, brand')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => {
        if (mounted) {
          setCommunities(data || [])
          setLoadingCommunities(false)
        }
      })
      .catch(() => { if (mounted) setLoadingCommunities(false) })
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    if (!selectedId) return
    let mounted = true
    loadCommunityData(selectedId, mounted)
    return () => { mounted = false }
  }, [selectedId])

  async function loadCommunityData(communityId, mounted = true) {
    setLoading(true)
    try {
    const [assignRes, scoreRes, feedbackRes] = await Promise.all([
      // Vendors assigned to this community
      supabase
        .from('vendor_community_assignments')
        .select('cost_code, vendors(id, name, vendor_categories(name), is_active)')
        .eq('community_id', communityId),
      // Current scores for all vendors
      supabase
        .from('score_results')
        .select('vendor_id, weighted_total, safety_score, schedule_score, rework_score, feedback_score, schedule_total_jobs, feedback_count'),
      // Feedback submitted for this community
      supabase
        .from('builder_feedback')
        .select('vendor_id, category, severity, points, is_approved, vendors(name)')
        .eq('community_id', communityId),
    ])

    const scoreMap = {}
    for (const s of (scoreRes.data || [])) scoreMap[s.vendor_id] = s

    const fbByVendor = {}
    for (const f of (feedbackRes.data || [])) {
      if (!fbByVendor[f.vendor_id]) fbByVendor[f.vendor_id] = { kudos: 0, complaints: 0, pending: 0, vendorName: f.vendors?.name }
      if (f.category === 'kudos') fbByVendor[f.vendor_id].kudos++
      else if (f.category === 'complaint') fbByVendor[f.vendor_id].complaints++
      if (!f.is_approved && f.reviewed_at === null) fbByVendor[f.vendor_id].pending++
    }

    const rows = (assignRes.data || [])
      .filter(a => a.vendors?.is_active)
      .map(a => ({
        vendor_id: a.vendors?.id,
        vendor_name: a.vendors?.name,
        category: a.vendors?.vendor_categories?.name,
        cost_code: a.cost_code,
        score: scoreMap[a.vendors?.id] || null,
        feedback: fbByVendor[a.vendors?.id] || { kudos: 0, complaints: 0, pending: 0 },
      }))
      .sort((a, b) => {
        const aScore = a.score?.weighted_total ?? -1
        const bScore = b.score?.weighted_total ?? -1
        return bScore - aScore
      })

    if (mounted) setVendorRows(rows)
    } catch (err) {
      console.error('loadCommunityData error:', err)
    } finally {
      if (mounted) setLoading(false)
    }
  }

  const community = communities.find(c => c.id === selectedId)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <MapPin className="w-6 h-6 text-teal-600" />
            Community Breakdown
          </h1>
          <p className="glass-page-subtitle">Vendor assignments and performance by community</p>
        </div>
      </div>

      {/* Community selector */}
      <div className="glass-panel p-4">
        <div className="flex items-center gap-4 flex-wrap">
          <label className="text-sm font-medium text-gray-700">Select Community:</label>
          {loadingCommunities ? (
            <span className="text-sm text-gray-400">Loading communities...</span>
          ) : (
            <select
              value={selectedId}
              onChange={e => setSelectedId(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-teal-500 outline-none min-w-[260px]"
            >
              <option value="">— Choose a community —</option>
              {communities.map(c => (
                <option key={c.id} value={c.id}>
                  {c.code ? `[${c.code}] ` : ''}{c.name}{c.brand ? ` · ${c.brand}` : ''}
                </option>
              ))}
            </select>
          )}
          {community && (
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-xs px-2 py-1 rounded-full bg-teal-50 text-teal-700 font-medium">
                {community.brand || 'AW/STL'}
              </span>
              {community.code && (
                <span className="text-xs font-mono px-2 py-1 bg-gray-100 text-gray-600 rounded">{community.code}</span>
              )}
            </div>
          )}
        </div>
      </div>

      {!selectedId && (
        <div className="glass-panel p-16 text-center">
          <Building2 className="w-12 h-12 mx-auto mb-3 text-teal-200" />
          <p className="text-sm font-medium text-gray-700">No community selected</p>
          <p className="text-xs text-gray-400 mt-1">Choose a community from the dropdown above to view vendor assignments and performance scores.</p>
        </div>
      )}

      {selectedId && loading && (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" />
        </div>
      )}

      {selectedId && !loading && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-4">
            <div className="glass-panel p-4 text-center">
              <p className="glass-page-title">{vendorRows.length}</p>
              <p className="text-xs text-gray-500 mt-1 flex items-center justify-center gap-1"><Users className="w-3.5 h-3.5" /> Assigned Vendors</p>
            </div>
            <div className="glass-panel p-4 text-center">
              <p className="text-2xl font-bold text-green-700">
                {vendorRows.reduce((s, r) => s + r.feedback.kudos, 0)}
              </p>
              <p className="text-xs text-gray-500 mt-1 flex items-center justify-center gap-1"><ThumbsUp className="w-3.5 h-3.5" /> Kudos (total)</p>
            </div>
            <div className="glass-panel p-4 text-center">
              <p className="text-2xl font-bold text-red-600">
                {vendorRows.reduce((s, r) => s + r.feedback.complaints, 0)}
              </p>
              <p className="text-xs text-gray-500 mt-1 flex items-center justify-center gap-1"><ThumbsDown className="w-3.5 h-3.5" /> Complaints (total)</p>
            </div>
          </div>

          {/* Vendor table */}
          {vendorRows.length === 0 ? (
            <div className="text-center py-12 text-gray-400 glass-panel">
              <p className="text-sm">No active vendors assigned to this community.</p>
            </div>
          ) : (
            <div className="glass-panel overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Vendor</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Category</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600 font-mono text-xs">Cost Code</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">Safety</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">Schedule</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">Rework</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">Feedback</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">Total</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-600">Kudos / Complaints</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {vendorRows.map((r, i) => {
                    const s = r.score
                    const tier = getTier(s?.weighted_total)
                    return (
                      <tr key={r.vendor_id || i} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">{r.vendor_name}</div>
                          {tier && tier.label !== 'No data' && (
                            <span className="glass-tier-pill" style={tierPillStyle(tier)}>{tier.label}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-500">{r.category || '—'}</td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-400">{r.cost_code || '—'}</td>
                        {['safety_score', 'schedule_score', 'rework_score', 'feedback_score'].map(field => (
                          <td key={field} className="px-4 py-3 text-right font-mono text-xs">
                            {s?.[field] != null ? (
                              <span className={`px-2 py-0.5 rounded ${
                                s[field] >= 85 ? 'bg-green-50 text-green-700' :
                                s[field] >= 70 ? 'bg-yellow-50 text-yellow-700' :
                                s[field] >= 50 ? 'bg-orange-50 text-orange-700' :
                                'bg-red-50 text-red-700'
                              }`}>{Number(s[field]).toFixed(1)}</span>
                            ) : <span className="text-gray-300">—</span>}
                          </td>
                        ))}
                        <td className="px-4 py-3 text-right">
                          {s?.weighted_total != null ? (
                            <span
                              className="font-bold font-mono text-sm px-2 py-0.5 rounded"
                              style={tier && tier.label !== 'No data'
                                ? { background: tier.softBg, color: tierValueColor(tier) }
                                : { background: 'var(--g-panel-2)', color: 'var(--g-dim)' }}
                            >{Number(s.weighted_total).toFixed(1)}</span>
                          ) : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-2 text-xs">
                            <span className="flex items-center gap-1 text-green-700 font-medium">
                              <ThumbsUp className="w-3 h-3" />{r.feedback.kudos}
                            </span>
                            <span className="text-gray-300">/</span>
                            <span className="flex items-center gap-1 text-red-600 font-medium">
                              <ThumbsDown className="w-3 h-3" />{r.feedback.complaints}
                            </span>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
