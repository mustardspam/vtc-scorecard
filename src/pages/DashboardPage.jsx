import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import ScoreSummaryCard from '../components/dashboard/ScoreSummaryCard'
import ParameterBreakdown from '../components/dashboard/ParameterBreakdown'
import PerformerCard from '../components/dashboard/PerformerCard'
import DashboardFilters from '../components/dashboard/DashboardFilters'
import WeightSliders from '../components/weights/WeightSliders'
import { useThresholds } from '../hooks/useThresholds'

export default function DashboardPage() {
  const navigate = useNavigate()
  const [scores, setScores] = useState([])
  const [weights, setWeights] = useState(null)
  const [communityCount, setCommunityCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({ community: '', category: '' })
  const { getTier } = useThresholds()

  useEffect(() => {
    let mounted = true
    loadData(mounted)
    return () => { mounted = false }
  }, [filters])

  async function loadData(mounted = true) {
    setLoading(true)
    try {
      let query = supabase
        .from('score_results')
        .select('*, vendors(name, category_id, vendor_categories(name))')
        .order('weighted_total', { ascending: false })

      if (filters.category) {
        query = query.eq('category_id', filters.category)
      }

      if (filters.community) {
        const { data: vendorIds, error: vcError } = await supabase
          .from('vendor_community_assignments')
          .select('vendor_id')
          .eq('community_id', filters.community)
        if (vcError) throw vcError
        const ids = [...new Set((vendorIds || []).map(v => v.vendor_id))]
        if (!ids.length) {
          if (mounted) setScores([])
          return
        }
        query = query.in('vendor_id', ids)
      }

      const [scoresRes, weightsRes, commRes] = await Promise.all([
        query,
        supabase.from('score_weights').select('*').eq('is_current', true).single(),
        supabase.from('communities').select('id', { count: 'exact', head: true }).eq('is_active', true),
      ])
      if (scoresRes.error) throw scoresRes.error
      if (mounted) {
        setScores(scoresRes.data || [])
        setWeights(weightsRes.data)
        setCommunityCount(commRes.count || 0)
      }
    } catch (err) {
      console.error('loadData error:', err)
    } finally {
      if (mounted) setLoading(false)
    }
  }

  const validScores = scores.filter(s => s.weighted_total != null)
  const vendorCount = validScores.length
  const avgScore = validScores.length
    ? (validScores.reduce((sum, s) => sum + Number(s.weighted_total), 0) / validScores.length).toFixed(1)
    : '—'
  const bestPerformers = validScores.slice(0, 5)
  const worstPerformers = [...validScores].reverse().slice(0, 5)
  const overallTier = avgScore !== '—' ? getTier(Number(avgScore)) : null

  const avgOf = (field) => {
    const subset = validScores.filter(s => s[field] != null && Number.isFinite(Number(s[field])))
    if (!subset.length) return '—'
    const avg = subset.reduce((sum, s) => sum + Number(s[field]), 0) / subset.length
    return Number.isFinite(avg) ? avg.toFixed(1) : '—'
  }

  const kpis = [
    { title: 'Safety', value: avgOf('safety_score'), field: 'safety_score', weightKey: 'safety_weight' },
    { title: 'Schedule', value: avgOf('schedule_score'), field: 'schedule_score', weightKey: 'schedule_weight' },
    { title: 'Rework', value: avgOf('rework_score'), field: 'rework_score', weightKey: 'rework_weight' },
    { title: 'Feedback', value: avgOf('feedback_score'), field: 'feedback_score', weightKey: 'feedback_weight' },
  ]

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="app-loading-spinner" />
      </div>
    )
  }

  return (
    <div className="space-y-3 min-w-0 max-w-full">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="glass-page-title">Dashboard</h1>
          <p className="glass-page-subtitle">
            Vendor &amp; Trade Performance · {vendorCount} vendors · {communityCount} communities
          </p>
        </div>
        <DashboardFilters filters={filters} onChange={setFilters} />
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-5 gap-3 min-w-0">
        <div className="col-span-2 xl:col-span-1 min-w-0">
          <ScoreSummaryCard
            title="Overall Average"
            value={avgScore}
            tier={overallTier}
            hero
          />
        </div>
        {kpis.map(k => (
          <div key={k.title} className="min-w-0">
            <ScoreSummaryCard
              title={k.title}
              value={k.value}
              tier={k.value !== '—' ? getTier(Number(k.value)) : null}
              subtitle={weights ? `${(weights[k.weightKey] * 100).toFixed(0)}% weight` : ''}
            />
          </div>
        ))}
      </div>

      <ParameterBreakdown scores={validScores} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 min-w-0">
        <div className="glass-panel p-4 sm:p-5 min-w-0">
          <h2 className="glass-section-title mb-4">Top Performers</h2>
          <div className="space-y-2">
            {bestPerformers.map((s, i) => (
              <PerformerCard
                key={s.id}
                rank={i + 1}
                name={s.vendors?.name || 'Unknown'}
                category={s.vendors?.vendor_categories?.name || ''}
                score={s.weighted_total}
                tier={getTier(s.weighted_total)}
                safetyCount={s.safety_incident_count}
                scheduleJobs={s.schedule_total_jobs}
                reworkCount={s.rework_count}
                feedbackCount={s.feedback_count}
                onClick={() => navigate(`/scores?vendor=${s.vendor_id}`)}
              />
            ))}
            {bestPerformers.length === 0 && (
              <p className="text-sm" style={{ color: 'var(--g-dim)' }}>No score data available. Upload data to get started.</p>
            )}
          </div>
        </div>

        <div className="glass-panel p-4 sm:p-5 min-w-0">
          <h2 className="glass-section-title mb-4">Needs Improvement</h2>
          <div className="space-y-2">
            {worstPerformers.map((s, i) => (
              <PerformerCard
                key={s.id}
                rank={validScores.length - i}
                name={s.vendors?.name || 'Unknown'}
                category={s.vendors?.vendor_categories?.name || ''}
                score={s.weighted_total}
                tier={getTier(s.weighted_total)}
                safetyCount={s.safety_incident_count}
                scheduleJobs={s.schedule_total_jobs}
                reworkCount={s.rework_count}
                feedbackCount={s.feedback_count}
                onClick={() => navigate(`/scores?vendor=${s.vendor_id}`)}
              />
            ))}
            {worstPerformers.length === 0 && (
              <p className="text-sm" style={{ color: 'var(--g-dim)' }}>No score data available.</p>
            )}
          </div>
        </div>
      </div>

      <div className="glass-panel p-4 sm:p-5 min-w-0">
        <h2 className="glass-section-title mb-4">Weight Configuration</h2>
        <WeightSliders />
      </div>
    </div>
  )
}
