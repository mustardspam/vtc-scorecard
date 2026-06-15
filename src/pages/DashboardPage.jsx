import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import ScoreSummaryCard from '../components/dashboard/ScoreSummaryCard'
import ParameterBreakdown from '../components/dashboard/ParameterBreakdown'
import PerformerCard from '../components/dashboard/PerformerCard'
import DashboardFilters from '../components/dashboard/DashboardFilters'
import WeightSliders from '../components/weights/WeightSliders'
import { useThresholds } from '../hooks/useThresholds'
import { TrendingUp, TrendingDown, Award, AlertTriangle } from 'lucide-react'

export default function DashboardPage() {
  const [scores, setScores] = useState([])
  const [weights, setWeights] = useState(null)
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
    let query = supabase
      .from('score_results')
      .select('*, vendors(name, category_id, vendor_categories(name))')
      .order('weighted_total', { ascending: false })

    if (filters.category) {
      query = query.eq('category_id', filters.category)
    }

    try {
      const [scoresRes, weightsRes] = await Promise.all([
        query,
        supabase.from('score_weights').select('*').eq('is_current', true).single()
      ])
      if (mounted) {
        setScores(scoresRes.data || [])
        setWeights(weightsRes.data)
      }
    } catch (err) {
      console.error('loadData error:', err)
    } finally {
      if (mounted) setLoading(false)
    }
  }

  const validScores = scores.filter(s => s.weighted_total != null)
  const avgScore = validScores.length
    ? (validScores.reduce((sum, s) => sum + Number(s.weighted_total), 0) / validScores.length).toFixed(1)
    : '—'
  const bestPerformers = validScores.slice(0, 5)
  const worstPerformers = [...validScores].reverse().slice(0, 5)

  const avgSafety = validScores.length
    ? (validScores.reduce((sum, s) => sum + (Number(s.safety_score) || 0), 0) / validScores.filter(s => s.safety_score != null).length).toFixed(1)
    : '—'
  const avgSchedule = validScores.length
    ? (validScores.reduce((sum, s) => sum + (Number(s.schedule_score) || 0), 0) / validScores.filter(s => s.schedule_score != null).length).toFixed(1)
    : '—'
  const avgRework = validScores.filter(s => s.rework_score != null).length
    ? (validScores.filter(s => s.rework_score != null).reduce((sum, s) => sum + Number(s.rework_score), 0) / validScores.filter(s => s.rework_score != null).length).toFixed(1)
    : '—'
  const avgFeedback = validScores.filter(s => s.feedback_score != null).length
    ? (validScores.filter(s => s.feedback_score != null).reduce((sum, s) => sum + Number(s.feedback_score), 0) / validScores.filter(s => s.feedback_score != null).length).toFixed(1)
    : '—'

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">Vendor & Trade Performance Overview</p>
        </div>
        <DashboardFilters filters={filters} onChange={setFilters} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <ScoreSummaryCard title="Overall Average" value={avgScore} icon={Award} color="blue" />
        <ScoreSummaryCard title="Safety" value={avgSafety} icon={TrendingUp} color="green" subtitle={weights ? `${(weights.safety_weight * 100).toFixed(1)}% weight` : ''} />
        <ScoreSummaryCard title="Schedule" value={avgSchedule} icon={TrendingUp} color="purple" subtitle={weights ? `${(weights.schedule_weight * 100).toFixed(1)}% weight` : ''} />
        <ScoreSummaryCard title="Rework" value={avgRework} icon={TrendingDown} color="orange" subtitle={weights ? `${(weights.rework_weight * 100).toFixed(1)}% weight` : ''} />
        <ScoreSummaryCard title="Feedback" value={avgFeedback} icon={TrendingUp} color="teal" subtitle={weights ? `${(weights.feedback_weight * 100).toFixed(1)}% weight` : ''} />
      </div>

      <ParameterBreakdown scores={validScores} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Award className="w-5 h-5 text-green-600" />
            Top Performers
          </h2>
          <div className="space-y-3">
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
                type="best"
              />
            ))}
            {bestPerformers.length === 0 && (
              <p className="text-sm text-gray-500">No score data available. Upload data to get started.</p>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-600" />
            Needs Improvement
          </h2>
          <div className="space-y-3">
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
                type="worst"
              />
            ))}
            {worstPerformers.length === 0 && (
              <p className="text-sm text-gray-500">No score data available.</p>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Weight Configuration</h2>
        <WeightSliders />
      </div>
    </div>
  )
}
