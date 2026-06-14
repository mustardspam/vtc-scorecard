const { createClient } = require('@supabase/supabase-js')

const RESEND_API_KEY = process.env.RESEND_API_KEY
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

// ── Recipients ─────────────────────────────────────────────────────────────
// Add or remove email addresses here
// Until a domain is verified at resend.com/domains, Resend only allows sending
// to the account owner email (mustardsubs@proton.me). After domain verification,
// replace FROM_ADDRESS below and add any recipients here.
const RECIPIENTS = [
  'mustardspam@proton.me',
]

const FROM_ADDRESS = 'VTC Scorecard <onboarding@resend.dev>'

// ───────────────────────────────────────────────────────────────────────────

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

async function loadData() {
  const since = new Date()
  since.setDate(since.getDate() - 30)

  const [scoresRes, feedbackRes, weightsRes] = await Promise.all([
    supabase
      .from('score_results')
      .select('weighted_total, vendors(name, vendor_categories(name))')
      .order('weighted_total', { ascending: false, nullsFirst: false }),
    supabase
      .from('builder_feedback')
      .select('category, severity, vendors(name), submitter:profiles!builder_feedback_submitted_by_fkey(full_name)')
      .eq('is_approved', true)
      .gte('submitted_at', since.toISOString())
      .order('submitted_at', { ascending: false })
      .limit(50),
    supabase.from('score_weights').select('*').eq('is_current', true).single(),
  ])

  return {
    scores: scoresRes.data || [],
    feedback: feedbackRes.data || [],
    weights: weightsRes.data,
  }
}

function buildEmail({ scores, feedback, weights }) {
  const valid = scores.filter(s => s.weighted_total != null)
  const tierCounts = { Good: 0, Watch: 0, Probation: 0, Critical: 0 }
  for (const s of valid) {
    const t = getTier(Number(s.weighted_total))
    if (t) tierCounts[t] = (tierCounts[t] || 0) + 1
  }

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
  lines.push('FLEET SUMMARY')
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
  top5.forEach((s, i) => lines.push(`  ${i + 1}. ${s.vendors?.name} — ${Number(s.weighted_total).toFixed(1)}`))
  lines.push('')

  lines.push('BOTTOM 5 PERFORMERS')
  lines.push('-'.repeat(40))
  bottom5.forEach((s, i) => lines.push(`  ${i + 1}. ${s.vendors?.name} — ${Number(s.weighted_total).toFixed(1)}`))
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
  lines.push(`Generated automatically from VTC Scorecard · ${date}`)

  return lines.join('\n')
}

async function sendEmail(subject, text, recipients) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: recipients,
      subject,
      text,
    }),
  })

  const data = await res.json()
  if (!res.ok) throw new Error(`Resend error ${res.status}: ${JSON.stringify(data)}`)
  return data
}

async function main() {
  console.log('Loading data from Supabase...')
  const data = await loadData()
  console.log(`Loaded ${data.scores.length} scores, ${data.feedback.length} feedback entries`)

  const text = buildEmail(data)
  const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const subject = `VTC Scorecard Weekly Digest — ${date}`

  console.log(`Sending to ${RECIPIENTS.length} recipients...`)
  const result = await sendEmail(subject, text, RECIPIENTS)
  console.log('Sent successfully:', result.id)
}

main().catch(err => {
  console.error('Digest email failed:', err.message)
  process.exit(1)
})
