import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useThresholds } from '../hooks/useThresholds'
import { useAuth } from '../hooks/useAuth'
import { useScoreData } from '../hooks/useScoreData'
import { useReferenceData } from '../hooks/useReferenceData'
import { Mail, Copy, Check, Printer, RefreshCw, TrendingUp, TrendingDown, Minus, Send } from 'lucide-react'

export default function DigestPage() {
  const [snapshots, setSnapshots] = useState([])
  const [priorScores, setPriorScores] = useState([])
  const [recentFeedback, setRecentFeedback] = useState([])
  const [minConfig, setMinConfig] = useState({ min_schedule_jobs: 5, min_feedback_count: 3, min_safety_records: 1, min_rework_records: 1 })
  const [metaLoading, setMetaLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendStatus, setSendStatus] = useState(null)
  const textRef = useRef(null)
  const { getTier } = useThresholds()
  const { isManager } = useAuth()
  const canSend = isManager()
  const { scores, loading: scoresLoading } = useScoreData()
  const { weights } = useReferenceData({ weights: true })

  useEffect(() => { loadMeta() }, [])

  async function loadMeta() {
    setMetaLoading(true)
    try {
    const since = new Date()
    since.setDate(since.getDate() - 30)

    const [snapshotsRes, feedbackRes, minConfigRes] = await Promise.all([
      supabase.from('snapshots').select('id, name, created_at').ilike('name', 'Week ending%').order('created_at', { ascending: false }).limit(1),
      supabase.from('builder_feedback').select('category, severity, points, vendors(name), submitter:profiles!builder_feedback_submitted_by_fkey(full_name)').eq('is_approved', true).gte('submitted_at', since.toISOString()).order('submitted_at', { ascending: false }).limit(50),
      supabase.from('system_config').select('key, value').in('key', ['min_schedule_jobs', 'min_feedback_count', 'min_safety_records', 'min_rework_records']),
    ])

    const parsedMin = { min_schedule_jobs: 5, min_feedback_count: 3, min_safety_records: 1, min_rework_records: 1 }
    for (const row of (minConfigRes.data || [])) parsedMin[row.key] = Number(row.value)

    const snaps = snapshotsRes.data || []
    let prior = []
    if (snaps.length >= 1) {
      const { data: priorData } = await supabase.from('snapshot_score_results').select('vendor_name, weighted_total, vendor_category').eq('snapshot_id', snaps[0].id)
      prior = priorData || []
    }

    setMinConfig(parsedMin)
    setSnapshots(snaps)
    setPriorScores(prior)
    setRecentFeedback(feedbackRes.data || [])
    } catch (err) {
      console.error('loadMeta error:', err)
    } finally {
      setMetaLoading(false)
    }
  }

  const loading = metaLoading || scoresLoading

  const filteredScores = scores.filter(s => {
    if (s.schedule_score != null && (s.schedule_total_jobs ?? 0) < minConfig.min_schedule_jobs) return false
    if (s.feedback_score != null && (s.feedback_count ?? 0) < minConfig.min_feedback_count) return false
    if (s.safety_score != null && minConfig.min_safety_records > 0 && (s.safety_incident_count ?? 0) < minConfig.min_safety_records) return false
    if (s.rework_score != null && minConfig.min_rework_records > 0 && (s.rework_count ?? 0) < minConfig.min_rework_records) return false
    return true
  })

  const valid = filteredScores.filter(s => s.weighted_total != null)
  const tierCounts = { Good: 0, Watch: 0, Probation: 0, Critical: 0 }
  for (const s of valid) {
    const t = getTier(s.weighted_total)
    if (t) tierCounts[t.label] = (tierCounts[t.label] || 0) + 1
  }

  const avgScore = valid.length
    ? valid.reduce((s, r) => s + Number(r.weighted_total), 0) / valid.length
    : null

  const critical = valid.filter(s => getTier(s.weighted_total)?.label === 'Critical')
  const probation = valid.filter(s => getTier(s.weighted_total)?.label === 'Probation')
  const top5 = valid.slice(0, 5)
  const bottom5 = [...valid].reverse().slice(0, 5)
  const kudos = recentFeedback.filter(f => f.category === 'kudos')
  const complaints = recentFeedback.filter(f => f.category === 'complaint')

  // Week-over-week calcs
  const priorValid = priorScores.filter(s => s.weighted_total != null)
  const priorAvg = priorValid.length
    ? priorValid.reduce((a, s) => a + Number(s.weighted_total), 0) / priorValid.length
    : null
  const avgDiff = avgScore != null && priorAvg != null ? avgScore - priorAvg : null

  const priorTierMap = {}
  for (const s of priorScores) priorTierMap[s.vendor_name] = s.weighted_total != null ? getTierLabel(Number(s.weighted_total)) : null

  function getTierLabel(score) {
    if (score >= 85) return 'Good'
    if (score >= 70) return 'Watch'
    if (score >= 50) return 'Probation'
    return 'Critical'
  }

  const movedIntoCritical = valid.filter(s => {
    const name = s.vendors?.name
    return getTier(s.weighted_total)?.label === 'Critical' && priorTierMap[name] && priorTierMap[name] !== 'Critical'
  })
  const movedOutOfCritical = valid.filter(s => {
    const name = s.vendors?.name
    return getTier(s.weighted_total)?.label !== 'Critical' && priorTierMap[name] === 'Critical'
  })

  // Category averages
  const catMap = {}
  for (const s of valid) {
    const cat = s.vendors?.vendor_categories?.name
    if (!cat) continue
    if (!catMap[cat]) catMap[cat] = { total: 0, count: 0 }
    catMap[cat].total += Number(s.weighted_total)
    catMap[cat].count++
  }
  const catAvgs = Object.entries(catMap).map(([name, { total, count }]) => ({ name, avg: total / count, count })).filter(c => c.count >= 2)
  catAvgs.sort((a, b) => b.avg - a.avg)
  const topCat = catAvgs[0]
  const bottomCat = catAvgs[catAvgs.length - 1]
  const priorSnapshotName = snapshots[0]?.name || null

  function buildSummaryText() {
    const lines = []
    lines.push('EXECUTIVE SUMMARY')
    lines.push('-'.repeat(40))

    if (avgScore != null) {
      let weekLine = priorAvg != null
        ? `Week over week (vs snapshot "${priorSnapshotName}"): Overall average ${avgDiff >= 0 ? 'rose' : 'fell'} ${avgDiff >= 0 ? '+' : ''}${avgDiff.toFixed(1)} pts to ${avgScore.toFixed(1)}.`
        : `This week: Overall average is ${avgScore.toFixed(1)} across ${valid.length} scored vendors.`
      if (movedIntoCritical.length > 0) weekLine += ` ${movedIntoCritical.map(s => s.vendors?.name).join(', ')} moved into Critical.`
      if (movedOutOfCritical.length > 0) weekLine += ` ${movedOutOfCritical.map(s => s.vendors?.name).join(', ')} improved out of Critical.`
      if (priorAvg != null && movedIntoCritical.length === 0 && movedOutOfCritical.length === 0) weekLine += ' No vendors changed Critical status.'
      lines.push(weekLine)
    }

    let thirtyLine = `Last 30 days: ${kudos.length + complaints.length} feedback submissions — ${kudos.length} kudos, ${complaints.length} complaints`
    thirtyLine += kudos.length > complaints.length ? ' (kudos outpacing complaints).' : complaints.length > kudos.length ? ' (complaints outpacing kudos — worth reviewing).' : ' (even split).'
    if (topCat && bottomCat && topCat.name !== bottomCat.name) {
      thirtyLine += ` ${topCat.name} leads all categories at ${topCat.avg.toFixed(1)}; ${bottomCat.name} is the lowest at ${bottomCat.avg.toFixed(1)}.`
    }
    if (tierCounts.Critical + tierCounts.Probation > 0) {
      thirtyLine += ` ${tierCounts.Critical + tierCounts.Probation} vendor${tierCounts.Critical + tierCounts.Probation > 1 ? 's' : ''} currently in Critical or Probation.`
    }
    lines.push(thirtyLine)
    lines.push('')
    return lines.join('\n')
  }

  function buildEmailText() {
    const date = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    const lines = []
    lines.push(`VTC SCORECARD DIGEST — ${date}`)
    lines.push('='.repeat(60))
    lines.push('')
    lines.push(buildSummaryText())
    lines.push('VENDOR/TRADE SUMMARY')
    lines.push('-'.repeat(40))
    lines.push(`Total vendors scored: ${valid.length}`)
    lines.push(`Average score: ${avgScore?.toFixed(1) ?? '—'}`)
    lines.push(`Good: ${tierCounts.Good}  |  Watch: ${tierCounts.Watch}  |  Probation: ${tierCounts.Probation}  |  Critical: ${tierCounts.Critical}`)
    if (weights) lines.push(`Weights: Safety ${(weights.safety_weight*100).toFixed(0)}% · Schedule ${(weights.schedule_weight*100).toFixed(0)}% · Rework ${(weights.rework_weight*100).toFixed(0)}% · Feedback ${(weights.feedback_weight*100).toFixed(0)}%`)
    lines.push('')
    if (critical.length > 0) {
      lines.push('🚨 CRITICAL VENDORS (immediate attention required)')
      lines.push('-'.repeat(40))
      for (const s of critical) lines.push(`  • ${s.vendors?.name} (${s.vendors?.vendor_categories?.name}) — Score: ${Number(s.weighted_total).toFixed(1)}`)
      lines.push('')
    }
    if (probation.length > 0) {
      lines.push('⚠️  PROBATION VENDORS')
      lines.push('-'.repeat(40))
      for (const s of probation) lines.push(`  • ${s.vendors?.name} (${s.vendors?.vendor_categories?.name}) — Score: ${Number(s.weighted_total).toFixed(1)}`)
      lines.push('')
    }
    lines.push('TOP 5 PERFORMERS')
    lines.push('-'.repeat(40))
    top5.forEach((s, i) => lines.push(`  ${i + 1}. ${s.vendors?.name} — ${Number(s.weighted_total).toFixed(1)}`))
    lines.push('')
    lines.push('BOTTOM 5 PERFORMERS')
    lines.push('-'.repeat(40))
    bottom5.forEach((s, i) => lines.push(`  ${i + 1}. ${s.vendors?.name} — ${Number(s.weighted_total).toFixed(1)}`))
    lines.push('')
    if (kudos.length > 0) {
      lines.push('👍 RECENT KUDOS (last 30 days, approved)')
      lines.push('-'.repeat(40))
      for (const f of kudos.slice(0, 5)) lines.push(`  • ${f.vendors?.name} — submitted by ${f.submitter?.full_name || 'Unknown'}`)
      lines.push('')
    }
    if (complaints.length > 0) {
      lines.push('👎 RECENT COMPLAINTS (last 30 days, approved)')
      lines.push('-'.repeat(40))
      for (const f of complaints.slice(0, 5)) lines.push(`  • ${f.vendors?.name} (${f.severity || 'unspecified'}) — submitted by ${f.submitter?.full_name || 'Unknown'}`)
      lines.push('')
    }
    lines.push('='.repeat(60))
    lines.push(`Generated from VTC Scorecard · ${date}`)
    return lines.join('\n')
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(buildEmailText())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleSendNow() {
    setSending(true)
    setSendStatus(null)
    try {
      const token = useAuth.getState().session?.access_token
      if (!token) {
        setSendStatus({ error: 'Not signed in' })
        return
      }
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trigger-digest`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok && body.success) {
        setSendStatus({ success: true })
        setTimeout(() => setSendStatus(null), 4000)
      } else {
        setSendStatus({ error: body.error || `Request failed (${res.status})` })
      }
    } catch (err) {
      setSendStatus({ error: err.message })
    } finally {
      setSending(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" />
      </div>
    )
  }

  const DiffBadge = ({ diff }) => {
    if (diff == null) return null
    const up = diff > 0
    const neutral = diff === 0
    const Icon = neutral ? Minus : up ? TrendingUp : TrendingDown
    const color = neutral ? 'text-gray-500' : up ? 'text-green-600' : 'text-red-600'
    return (
      <span className={`flex items-center gap-1 text-xs font-medium ${color}`}>
        <Icon className="w-3 h-3" />
        {up ? '+' : ''}{diff.toFixed(1)} vs prior snapshot
      </span>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Mail className="w-6 h-6 text-teal-600" />
            Digest Email
          </h1>
          <p className="glass-page-subtitle">Performance summary — sent automatically every Monday at 8am ET</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            <button onClick={loadMeta} className="flex items-center gap-1 glass-btn-secondary text-sm py-1.5">
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
            <button onClick={handleCopy} className="flex items-center gap-1 px-3 py-1.5 text-sm bg-teal-600 text-white rounded-lg hover:bg-teal-700">
              {copied ? <><Check className="w-4 h-4" /> Copied!</> : <><Copy className="w-4 h-4" /> Copy Text</>}
            </button>
            <button onClick={() => window.print()} className="flex items-center gap-1 glass-btn-secondary text-sm py-1.5 no-print">
              <Printer className="w-4 h-4" /> Print
            </button>
            {canSend && (
              <button
                onClick={handleSendNow}
                disabled={sending}
                className="flex items-center gap-1 px-3 py-1.5 text-sm glass-btn-primary disabled:opacity-60 no-print"
              >
                <Send className="w-4 h-4" /> {sending ? 'Sending…' : 'Send Now'}
              </button>
            )}
          </div>
          {sendStatus?.success && (
            <p className="text-xs text-green-600 flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Digest triggered — email will arrive within a minute.</p>
          )}
          {sendStatus?.error && (
            <p className="text-xs text-red-600">{sendStatus.error}</p>
          )}
        </div>
      </div>

      {/* Executive Summary */}
      <div className="glass-panel overflow-hidden no-print">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
          <span className="text-sm font-medium text-gray-700">Executive summary</span>
          {priorSnapshotName && <span className="ml-2 text-xs text-gray-400">vs snapshot "{priorSnapshotName}"</span>}
        </div>
        <div className="p-4 grid grid-cols-2 lg:grid-cols-4 gap-3 border-b border-gray-100">
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-500 mb-1">Avg score</p>
            <p className="text-xl font-bold text-gray-900">{avgScore?.toFixed(1) ?? '—'}</p>
            <DiffBadge diff={avgDiff} />
          </div>
          <div className="bg-red-50 rounded-lg p-3">
            <p className="text-xs text-red-500 mb-1">Critical</p>
            <p className="text-xl font-bold text-red-700">{tierCounts.Critical}</p>
            {movedIntoCritical.length > 0 && <span className="text-xs text-red-600">+{movedIntoCritical.length} this week</span>}
            {movedOutOfCritical.length > 0 && <span className="text-xs text-green-600">-{movedOutOfCritical.length} this week</span>}
          </div>
          <div className="bg-green-50 rounded-lg p-3">
            <p className="text-xs text-green-600 mb-1">Good standing</p>
            <p className="text-xl font-bold text-green-700">{tierCounts.Good}</p>
          </div>
          <div className="bg-blue-50 rounded-lg p-3">
            <p className="text-xs text-blue-500 mb-1">Feedback (30d)</p>
            <p className="text-xl font-bold text-blue-700">{kudos.length + complaints.length}</p>
            <span className="text-xs text-blue-600">{kudos.length} kudos · {complaints.length} complaints</span>
          </div>
        </div>
        <div className="p-4 space-y-3">
          <div className="border-l-4 border-teal-500 pl-3">
            <p className="text-xs font-semibold text-gray-500 mb-1">This week</p>
            <p className="text-sm text-gray-700 leading-relaxed">
              {avgScore != null && priorAvg != null
                ? <>Overall average {avgDiff >= 0 ? 'rose' : 'fell'} {avgDiff >= 0 ? '+' : ''}{avgDiff.toFixed(1)} pts to {avgScore.toFixed(1)} compared to the prior snapshot.{' '}
                  {movedIntoCritical.length > 0 && <><strong>{movedIntoCritical.map(s => s.vendors?.name).join(', ')}</strong> moved into Critical.{' '}</>}
                  {movedOutOfCritical.length > 0 && <><strong>{movedOutOfCritical.map(s => s.vendors?.name).join(', ')}</strong> improved out of Critical.{' '}</>}
                  {movedIntoCritical.length === 0 && movedOutOfCritical.length === 0 && 'No vendors changed Critical status.'}</>
                : <>Overall average is {avgScore?.toFixed(1) ?? '—'} across {valid.length} scored vendors. {tierCounts.Critical} critical, {tierCounts.Probation} on probation, {tierCounts.Good} in good standing.</>
              }
            </p>
          </div>
          <div className="border-l-4 border-gray-300 pl-3">
            <p className="text-xs font-semibold text-gray-500 mb-1">Last 30 days</p>
            <p className="text-sm text-gray-700 leading-relaxed">
              {kudos.length + complaints.length} feedback submissions received — {kudos.length} kudos, {complaints.length} complaints
              {kudos.length > complaints.length ? ' (kudos outpacing complaints)' : complaints.length > kudos.length ? ' (complaints outpacing kudos — worth reviewing)' : ' (even split)'}.
              {topCat && bottomCat && topCat.name !== bottomCat.name && <> {topCat.name} leads all categories at {topCat.avg.toFixed(1)}; {bottomCat.name} is the lowest at {bottomCat.avg.toFixed(1)}.</>}
              {tierCounts.Critical + tierCounts.Probation > 0 && <> {tierCounts.Critical + tierCounts.Probation} vendor{tierCounts.Critical + tierCounts.Probation > 1 ? 's' : ''} currently in Critical or Probation status.</>}
            </p>
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 no-print">
        <div className="glass-panel p-4 text-center">
          <p className="glass-page-title">{valid.length}</p>
          <p className="text-xs text-gray-500 mt-1">Vendors Scored</p>
        </div>
        <div className="bg-green-50 rounded-xl border border-green-100 p-4 text-center">
          <p className="text-2xl font-bold text-green-700">{tierCounts.Good}</p>
          <p className="text-xs text-green-600 mt-1">Good</p>
        </div>
        <div className="bg-orange-50 rounded-xl border border-orange-100 p-4 text-center">
          <p className="text-2xl font-bold text-orange-700">{tierCounts.Probation}</p>
          <p className="text-xs text-orange-600 mt-1">Probation</p>
        </div>
        <div className="bg-red-50 rounded-xl border border-red-100 p-4 text-center">
          <p className="text-2xl font-bold text-red-700">{tierCounts.Critical}</p>
          <p className="text-xs text-red-600 mt-1">Critical</p>
        </div>
      </div>

      {critical.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 no-print">
          <h3 className="text-sm font-semibold text-red-700 mb-2">🚨 Critical — Immediate Attention</h3>
          <div className="space-y-1">
            {critical.map(s => (
              <div key={s.id} className="flex items-center justify-between text-sm">
                <span className="font-medium text-red-900">{s.vendors?.name}</span>
                <span className="font-mono font-bold text-red-700">{Number(s.weighted_total).toFixed(1)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Plain-text email preview */}
      <div className="glass-panel overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50 no-print">
          <span className="text-sm font-medium text-gray-700">Email preview (plain text)</span>
          <span className="text-xs text-gray-400">This is what recipients receive every Monday</span>
        </div>
        <pre ref={textRef} className="p-6 text-xs text-gray-700 font-mono whitespace-pre-wrap leading-relaxed overflow-auto max-h-[600px]" style={{ fontFamily: 'Consolas, "Courier New", monospace' }}>
          {buildEmailText()}
        </pre>
      </div>
    </div>
  )
}
