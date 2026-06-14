const { createClient } = require('@supabase/supabase-js')

const RESEND_API_KEY = process.env.RESEND_API_KEY
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const FROM_ADDRESS = 'VTC Scorecard <digest@vtcouncil.online>'

if (!RESEND_API_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing required env vars: RESEND_API_KEY, SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const TIER_THRESHOLDS = { good: 85, watch: 70, probation: 50 }

function getTier(score) {
  if (score == null) return null
  if (score >= TIER_THRESHOLDS.good) return 'Good'
  if (score >= TIER_THRESHOLDS.watch) return 'Watch'
  if (score >= TIER_THRESHOLDS.probation) return 'Probation'
  return 'Critical'
}

async function loadRecipients() {
  const { data } = await supabase.from('system_config').select('value').eq('key', 'digest_recipients').single()
  if (!data?.value) return []
  try { return JSON.parse(data.value) } catch { return [] }
}

async function loadData() {
  const since = new Date()
  since.setDate(since.getDate() - 30)

  const [scoresRes, feedbackRes, weightsRes, snapshotsRes] = await Promise.all([
    supabase.from('score_results').select('weighted_total, vendors(name, vendor_categories(name))').order('weighted_total', { ascending: false, nullsFirst: false }),
    supabase.from('builder_feedback').select('category, severity, vendors(name), submitter:profiles!builder_feedback_submitted_by_fkey(full_name)').eq('is_approved', true).gte('submitted_at', since.toISOString()).order('submitted_at', { ascending: false }).limit(50),
    supabase.from('score_weights').select('*').eq('is_current', true).single(),
    // Prefer the most recent auto-generated "Week ending" snapshot for comparison
    supabase.from('snapshots').select('id, name, created_at').ilike('name', 'Week ending%').order('created_at', { ascending: false }).limit(1),
  ])

  let priorScores = []
  const snapshots = snapshotsRes.data || []
  if (snapshots.length >= 1) {
    const { data: priorData } = await supabase
      .from('snapshot_score_results')
      .select('vendor_name, weighted_total, vendor_category')
      .eq('snapshot_id', snapshots[0].id)
    priorScores = priorData || []
  }

  return {
    scores: scoresRes.data || [],
    feedback: feedbackRes.data || [],
    weights: weightsRes.data,
    priorScores,
    priorSnapshotName: snapshots[0]?.name || null,
  }
}

function buildExecutiveSummary({ scores, feedback, priorScores, priorSnapshotName }) {
  const valid = scores.filter(s => s.weighted_total != null)
  if (valid.length === 0) return null

  const avg = valid.reduce((a, s) => a + Number(s.weighted_total), 0) / valid.length
  const tierCounts = { Good: 0, Watch: 0, Probation: 0, Critical: 0 }
  for (const s of valid) { const t = getTier(Number(s.weighted_total)); if (t) tierCounts[t]++ }

  const kudos = feedback.filter(f => f.category === 'kudos').length
  const complaints = feedback.filter(f => f.category === 'complaint').length

  // Category averages
  const catMap = {}
  for (const s of valid) {
    const cat = s.vendors?.vendor_categories?.name
    if (!cat) continue
    if (!catMap[cat]) catMap[cat] = { total: 0, count: 0 }
    catMap[cat].total += Number(s.weighted_total)
    catMap[cat].count++
  }
  const catAvgs = Object.entries(catMap).map(([name, { total, count }]) => ({ name, avg: total / count })).filter(c => c.count >= 2)
  catAvgs.sort((a, b) => b.avg - a.avg)
  const topCat = catAvgs[0]
  const bottomCat = catAvgs[catAvgs.length - 1]

  const lines = []
  lines.push('EXECUTIVE SUMMARY')
  lines.push('-'.repeat(40))

  // Week-over-week
  if (priorScores.length > 0) {
    const priorAvg = priorScores.filter(s => s.weighted_total != null).reduce((a, s) => a + Number(s.weighted_total), 0) / priorScores.length
    const avgDiff = avg - priorAvg
    const sign = avgDiff >= 0 ? '+' : ''

    const priorTierMap = {}
    for (const s of priorScores) { priorTierMap[s.vendor_name] = getTier(Number(s.weighted_total)) }

    const movedIn = []
    const movedOut = []
    for (const s of valid) {
      const name = s.vendors?.name
      const nowTier = getTier(Number(s.weighted_total))
      const wasTier = priorTierMap[name]
      if (!wasTier || wasTier === nowTier) continue
      if (nowTier === 'Critical') movedIn.push(name)
      if (wasTier === 'Critical' && nowTier !== 'Critical') movedOut.push(name)
    }

    const label = priorSnapshotName ? `vs snapshot "${priorSnapshotName}"` : 'vs prior snapshot'
    let weekLine = `Week over week (${label}): Overall average ${avgDiff >= 0 ? 'rose' : 'fell'} ${sign}${Math.abs(avgDiff).toFixed(1)} pts to ${avg.toFixed(1)}.`
    if (movedIn.length > 0) weekLine += ` ${movedIn.join(', ')} ${movedIn.length === 1 ? 'moved' : 'moved'} into Critical.`
    if (movedOut.length > 0) weekLine += ` ${movedOut.join(', ')} ${movedOut.length === 1 ? 'improved out of' : 'improved out of'} Critical.`
    if (movedIn.length === 0 && movedOut.length === 0) weekLine += ' No vendors changed Critical status.'
    lines.push(weekLine)
  } else {
    lines.push(`This week: Overall average is ${avg.toFixed(1)} across ${valid.length} scored vendors. ${tierCounts.Critical} critical, ${tierCounts.Probation} on probation, ${tierCounts.Good} in good standing.`)
  }

  // 30-day
  let thirtyLine = `Last 30 days: ${kudos + complaints} feedback submissions received — ${kudos} kudos, ${complaints} complaints`
  thirtyLine += kudos > complaints ? ` (kudos outpacing complaints).` : complaints > kudos ? ` (complaints outpacing kudos — worth reviewing).` : ` (even split).`
  if (topCat && bottomCat && topCat.name !== bottomCat.name) {
    thirtyLine += ` ${topCat.name} leads all categories at ${topCat.avg.toFixed(1)}`
    thirtyLine += `; ${bottomCat.name} is the lowest at ${bottomCat.avg.toFixed(1)}.`
  }
  if (tierCounts.Critical + tierCounts.Probation > 0) {
    thirtyLine += ` ${tierCounts.Critical + tierCounts.Probation} vendor${tierCounts.Critical + tierCounts.Probation > 1 ? 's' : ''} currently in Critical or Probation status.`
  }
  lines.push(thirtyLine)
  lines.push('')

  return lines.join('\n')
}

function buildEmail({ scores, feedback, weights, priorScores, priorSnapshotName }) {
  const valid = scores.filter(s => s.weighted_total != null)
  const tierCounts = { Good: 0, Watch: 0, Probation: 0, Critical: 0 }
  for (const s of valid) { const t = getTier(Number(s.weighted_total)); if (t) tierCounts[t]++ }

  const avg = valid.length
    ? (valid.reduce((a, s) => a + Number(s.weighted_total), 0) / valid.length).toFixed(1)
    : '—'

  const critical = valid.filter(s => getTier(Number(s.weighted_total)) === 'Critical')
  const probation = valid.filter(s => getTier(Number(s.weighted_total)) === 'Probation')
  const top5 = valid.slice(0, 5)
  const bottom5 = [...valid].reverse().slice(0, 5)
  const kudos = feedback.filter(f => f.category === 'kudos').slice(0, 5)
  const complaints = feedback.filter(f => f.category === 'complaint').slice(0, 5)

  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const lines = []

  lines.push(`VTC SCORECARD DIGEST — ${date}`)
  lines.push('='.repeat(60))
  lines.push('')

  const summary = buildExecutiveSummary({ scores, feedback, priorScores, priorSnapshotName })
  if (summary) lines.push(summary)

  lines.push('VENDOR/TRADE SUMMARY')
  lines.push('-'.repeat(40))
  lines.push(`Total vendors scored: ${valid.length}`)
  lines.push(`Average score: ${avg}`)
  lines.push(`Good: ${tierCounts.Good}  |  Watch: ${tierCounts.Watch}  |  Probation: ${tierCounts.Probation}  |  Critical: ${tierCounts.Critical}`)
  if (weights) {
    lines.push(`Weights: Safety ${(weights.safety_weight * 100).toFixed(0)}% · Schedule ${(weights.schedule_weight * 100).toFixed(0)}% · Rework ${(weights.rework_weight * 100).toFixed(0)}% · Feedback ${(weights.feedback_weight * 100).toFixed(0)}%`)
  }
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
    for (const f of kudos) lines.push(`  • ${f.vendors?.name} — submitted by ${f.submitter?.full_name || 'Unknown'}`)
    lines.push('')
  }

  if (complaints.length > 0) {
    lines.push('👎 RECENT COMPLAINTS (last 30 days, approved)')
    lines.push('-'.repeat(40))
    for (const f of complaints) lines.push(`  • ${f.vendors?.name} (${f.severity || 'unspecified'}) — submitted by ${f.submitter?.full_name || 'Unknown'}`)
    lines.push('')
  }

  lines.push('='.repeat(60))
  lines.push(`Generated automatically from VTC Scorecard · ${date}`)

  return lines.join('\n')
}

async function sendEmail(subject, text, recipients) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_ADDRESS, to: recipients, subject, text }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`Resend error ${res.status}: ${JSON.stringify(data)}`)
  return data
}

async function main() {
  console.log('Loading recipients from Supabase...')
  const recipients = await loadRecipients()
  if (recipients.length === 0) {
    console.log('No recipients configured. Add emails in Admin → Digest Recipients.')
    process.exit(0)
  }

  console.log('Loading data from Supabase...')
  const data = await loadData()
  console.log(`Loaded ${data.scores.length} scores, ${data.feedback.length} feedback entries, ${data.priorScores.length} prior snapshot scores`)

  const text = buildEmail(data)
  const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const subject = `VTC Scorecard Weekly Digest — ${date}`

  console.log(`Sending to ${recipients.length} recipients: ${recipients.join(', ')}`)
  const result = await sendEmail(subject, text, recipients)
  console.log('Sent successfully:', result.id)
}

main().catch(err => {
  console.error('Digest email failed:', err.message)
  process.exit(1)
})
