import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useThresholds } from '../hooks/useThresholds'
import { Mail, Copy, Check, Printer, RefreshCw } from 'lucide-react'

export default function DigestPage() {
  const [scores, setScores] = useState([])
  const [snapshots, setSnapshots] = useState([])
  const [recentFeedback, setRecentFeedback] = useState([])
  const [weights, setWeights] = useState(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const textRef = useRef(null)
  const { getTier } = useThresholds()

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const since = new Date()
    since.setDate(since.getDate() - 30)

    const [scoresRes, snapshotsRes, feedbackRes, weightsRes] = await Promise.all([
      supabase.from('score_results')
        .select('*, vendors(name, vendor_categories(name))')
        .order('weighted_total', { ascending: false, nullsFirst: false }),
      supabase.from('snapshots')
        .select('id, name, created_at')
        .order('created_at', { ascending: false })
        .limit(2),
      supabase.from('builder_feedback')
        .select('category, severity, points, vendors(name), submitter:profiles!builder_feedback_submitted_by_fkey(full_name)')
        .eq('is_approved', true)
        .gte('submitted_at', since.toISOString())
        .order('submitted_at', { ascending: false })
        .limit(50),
      supabase.from('score_weights').select('*').eq('is_current', true).single(),
    ])

    setScores(scoresRes.data || [])
    setSnapshots(snapshotsRes.data || [])
    setRecentFeedback(feedbackRes.data || [])
    setWeights(weightsRes.data)
    setLoading(false)
  }

  const valid = scores.filter(s => s.weighted_total != null)
  const tierCounts = { Good: 0, Watch: 0, Probation: 0, Critical: 0 }
  for (const s of valid) {
    const t = getTier(s.weighted_total)
    if (t) tierCounts[t.label] = (tierCounts[t.label] || 0) + 1
  }

  const avgScore = valid.length
    ? (valid.reduce((s, r) => s + Number(r.weighted_total), 0) / valid.length).toFixed(1)
    : '—'

  const critical = valid.filter(s => getTier(s.weighted_total)?.label === 'Critical')
  const probation = valid.filter(s => getTier(s.weighted_total)?.label === 'Probation')
  const top5 = valid.slice(0, 5)
  const bottom5 = [...valid].reverse().slice(0, 5)
  const kudos = recentFeedback.filter(f => f.category === 'kudos').slice(0, 5)
  const complaints = recentFeedback.filter(f => f.category === 'complaint').slice(0, 5)

  function buildEmailText() {
    const date = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    const lines = []
    lines.push(`VTC SCORECARD DIGEST — ${date}`)
    lines.push('='.repeat(60))
    lines.push('')

    lines.push('VENDOR/TRADE SUMMARY')
    lines.push('-'.repeat(40))
    lines.push(`Total vendors scored: ${valid.length}`)
    lines.push(`Average score: ${avgScore}`)
    lines.push(`Good: ${tierCounts.Good}  |  Watch: ${tierCounts.Watch}  |  Probation: ${tierCounts.Probation}  |  Critical: ${tierCounts.Critical}`)
    if (weights) {
      lines.push(`Weights: Safety ${(weights.safety_weight*100).toFixed(0)}% · Schedule ${(weights.schedule_weight*100).toFixed(0)}% · Rework ${(weights.rework_weight*100).toFixed(0)}% · Feedback ${(weights.feedback_weight*100).toFixed(0)}%`)
    }
    lines.push('')

    if (critical.length > 0) {
      lines.push('🚨 CRITICAL VENDORS (immediate attention required)')
      lines.push('-'.repeat(40))
      for (const s of critical) {
        lines.push(`  • ${s.vendors?.name} (${s.vendors?.vendor_categories?.name}) — Score: ${Number(s.weighted_total).toFixed(1)}`)
      }
      lines.push('')
    }

    if (probation.length > 0) {
      lines.push('⚠️  PROBATION VENDORS')
      lines.push('-'.repeat(40))
      for (const s of probation) {
        lines.push(`  • ${s.vendors?.name} (${s.vendors?.vendor_categories?.name}) — Score: ${Number(s.weighted_total).toFixed(1)}`)
      }
      lines.push('')
    }

    lines.push('TOP 5 PERFORMERS')
    lines.push('-'.repeat(40))
    top5.forEach((s, i) => {
      lines.push(`  ${i + 1}. ${s.vendors?.name} — ${Number(s.weighted_total).toFixed(1)}`)
    })
    lines.push('')

    lines.push('BOTTOM 5 PERFORMERS')
    lines.push('-'.repeat(40))
    bottom5.forEach((s, i) => {
      lines.push(`  ${i + 1}. ${s.vendors?.name} — ${Number(s.weighted_total).toFixed(1)}`)
    })
    lines.push('')

    if (kudos.length > 0) {
      lines.push('👍 RECENT KUDOS (last 30 days, approved)')
      lines.push('-'.repeat(40))
      for (const f of kudos) {
        lines.push(`  • ${f.vendors?.name} — submitted by ${f.submitter?.full_name || 'Unknown'}`)
      }
      lines.push('')
    }

    if (complaints.length > 0) {
      lines.push('👎 RECENT COMPLAINTS (last 30 days, approved)')
      lines.push('-'.repeat(40))
      for (const f of complaints) {
        lines.push(`  • ${f.vendors?.name} (${f.severity || 'unspecified'}) — submitted by ${f.submitter?.full_name || 'Unknown'}`)
      }
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" />
      </div>
    )
  }

  const emailText = buildEmailText()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Mail className="w-6 h-6 text-teal-600" />
            Digest Email
          </h1>
          <p className="text-sm text-gray-500 mt-1">Generate a performance summary to share with your team</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadData} className="flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-teal-600 text-white rounded-lg hover:bg-teal-700"
          >
            {copied ? <><Check className="w-4 h-4" /> Copied!</> : <><Copy className="w-4 h-4" /> Copy Text</>}
          </button>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 no-print"
          >
            <Printer className="w-4 h-4" /> Print
          </button>
        </div>
      </div>

      {/* Visual preview */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 no-print">
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{valid.length}</p>
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
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50 no-print">
          <span className="text-sm font-medium text-gray-700">Email Preview (plain text)</span>
          <span className="text-xs text-gray-400">Paste into Outlook, Gmail, or Teams</span>
        </div>
        <pre
          ref={textRef}
          className="p-6 text-xs text-gray-700 font-mono whitespace-pre-wrap leading-relaxed overflow-auto max-h-[600px]"
          style={{ fontFamily: 'Consolas, "Courier New", monospace' }}
        >
          {emailText}
        </pre>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800 no-print">
        <p className="font-medium mb-1">Automating this digest</p>
        <p className="text-xs text-blue-700">To send this automatically on a schedule, ask your IT team to set up a Supabase Edge Function + pg_cron that emails this data weekly. Alternatively, bookmark this page and copy/paste the text into an email each week.</p>
      </div>
    </div>
  )
}
