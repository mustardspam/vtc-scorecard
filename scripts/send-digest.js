const { createClient } = require('@supabase/supabase-js')
// Single source of truth for the digest body — shared with the in-app preview
// (src/pages/DigestPage.jsx) so the delivered email can never drift from the
// website. Node 24 supports require() of this ESM module.
const { buildDigestText, TIER_THRESHOLDS, MIN_DEFAULTS } = require('../src/lib/digest-email.js')

const RESEND_API_KEY = process.env.RESEND_API_KEY
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const FROM_ADDRESS = 'VTC Scorecard <digest@vtcouncil.online>'

if (!RESEND_API_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing required env vars: RESEND_API_KEY, SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

async function loadRecipients() {
  // Recipients = every active user (auto-enrolled on signup) + any manually
  // added external addresses from system_config.digest_recipients.
  const [profilesRes, configRes] = await Promise.all([
    supabase.from('profiles').select('email').eq('is_active', true),
    supabase.from('system_config').select('value').eq('key', 'digest_recipients').single(),
  ])

  const set = new Set()

  for (const p of (profilesRes.data || [])) {
    const email = (p.email || '').trim().toLowerCase()
    if (email.includes('@')) set.add(email)
  }

  let manual = []
  const raw = configRes.data?.value
  if (raw) {
    try { manual = typeof raw === 'string' ? JSON.parse(raw) : raw } catch { manual = [] }
  }
  for (const e of (Array.isArray(manual) ? manual : [])) {
    const email = String(e || '').trim().toLowerCase()
    if (email.includes('@')) set.add(email)
  }

  return [...set]
}

async function loadData() {
  const since = new Date()
  since.setDate(since.getDate() - 30)

  const [scoresRes, feedbackRes, weightsRes, snapshotsRes, configRes] = await Promise.all([
    supabase.from('score_results').select('weighted_total, safety_score, schedule_score, rework_score, feedback_score, schedule_total_jobs, feedback_count, safety_incident_count, rework_count, vendors(name, vendor_categories(name))').order('weighted_total', { ascending: false, nullsFirst: false }),
    supabase.from('builder_feedback').select('category, severity, vendors(name), submitter:profiles!builder_feedback_submitted_by_fkey(full_name)').eq('is_approved', true).gte('submitted_at', since.toISOString()).order('submitted_at', { ascending: false }).limit(50),
    supabase.from('score_weights').select('*').eq('is_current', true).single(),
    supabase.from('snapshots').select('id, name, created_at').ilike('name', 'Week ending%').order('created_at', { ascending: false }).limit(1),
    supabase.from('system_config').select('key, value').in('key', ['min_schedule_jobs', 'min_feedback_count', 'min_safety_records', 'min_rework_records', 'threshold_good', 'threshold_watch', 'threshold_probation']),
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

  // Pull configurable tier + minimum-data thresholds from system_config, falling
  // back to the same defaults the app uses. buildDigestText applies both.
  const cfg = {}
  for (const row of (configRes.data || [])) cfg[row.key] = Number(row.value)
  const minThresholds = {
    min_schedule_jobs: cfg.min_schedule_jobs ?? MIN_DEFAULTS.min_schedule_jobs,
    min_feedback_count: cfg.min_feedback_count ?? MIN_DEFAULTS.min_feedback_count,
    min_safety_records: cfg.min_safety_records ?? MIN_DEFAULTS.min_safety_records,
    min_rework_records: cfg.min_rework_records ?? MIN_DEFAULTS.min_rework_records,
  }
  const thresholds = {
    good: cfg.threshold_good ?? TIER_THRESHOLDS.good,
    watch: cfg.threshold_watch ?? TIER_THRESHOLDS.watch,
    probation: cfg.threshold_probation ?? TIER_THRESHOLDS.probation,
  }

  const permit = await loadPermitData()

  return {
    scores: scoresRes.data || [],
    feedback: feedbackRes.data || [],
    weights: weightsRes.data,
    priorScores,
    priorSnapshotName: snapshots[0]?.name || null,
    permitSeries: permit?.series || [],
    permitMeta: permit?.meta || null,
    thresholds,
    minThresholds,
  }
}

// Loads the most recent permit import + its normalized series. The latest import
// carries the full trailing window, so it is the source of truth for the demand
// box — a new monthly upload automatically becomes the newest import here.
async function loadPermitData() {
  try {
    const { data: imports } = await supabase
      .from('permit_imports')
      .select('id, source_label, report_month')
      .order('report_month', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
    const latest = imports?.[0]
    if (!latest) return null

    const { data: series } = await supabase
      .from('permit_series')
      .select('scope_type, scope_name, period_month, permits')
      .eq('import_id', latest.id)
    if (!series?.length) return null
    return { meta: latest, series }
  } catch (err) {
    console.warn('loadPermitData failed (non-fatal):', err.message)
    return null
  }
}

// Resend caps the combined to + cc + bcc recipients at 50 per email. Send in
// batches so the digest scales past that. Each recipient is placed in `bcc`
// (with a single `to` of the from-address) so recipients can't see each other's
// emails — important since recipients span competing builders. The `to` slot
// counts toward the 50, so cap bcc at 49.
const RESEND_MAX_RECIPIENTS = 49

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

async function sendBatch(subject, text, recipients) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_ADDRESS, to: FROM_ADDRESS, bcc: recipients, subject, text }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`Resend error ${res.status}: ${JSON.stringify(data)}`)
  return data
}

async function sendEmail(subject, text, recipients) {
  const batches = chunk(recipients, RESEND_MAX_RECIPIENTS)
  const ids = []
  for (let i = 0; i < batches.length; i++) {
    const result = await sendBatch(subject, text, batches[i])
    console.log(`Batch ${i + 1}/${batches.length} sent (${batches[i].length} recipients): ${result.id}`)
    ids.push(result.id)
  }
  return { id: ids.join(', ') }
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

  const text = buildDigestText(data)
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
