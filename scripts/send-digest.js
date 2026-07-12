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

  const [scoresRes, feedbackRes, weightsRes, snapshotsRes, minConfigRes] = await Promise.all([
    supabase.from('score_results').select('weighted_total, safety_score, schedule_score, rework_score, feedback_score, schedule_total_jobs, feedback_count, safety_incident_count, rework_count, vendors(name, vendor_categories(name))').order('weighted_total', { ascending: false, nullsFirst: false }),
    supabase.from('builder_feedback').select('category, severity, vendors(name), submitter:profiles!builder_feedback_submitted_by_fkey(full_name)').eq('is_approved', true).gte('submitted_at', since.toISOString()).order('submitted_at', { ascending: false }).limit(50),
    supabase.from('score_weights').select('*').eq('is_current', true).single(),
    supabase.from('snapshots').select('id, name, created_at').ilike('name', 'Week ending%').order('created_at', { ascending: false }).limit(1),
    supabase.from('system_config').select('key, value').in('key', ['min_schedule_jobs', 'min_feedback_count', 'min_safety_records', 'min_rework_records']),
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

  // Parse minimum thresholds from system_config
  const minConfig = {}
  for (const row of (minConfigRes.data || [])) minConfig[row.key] = Number(row.value)
  const minScheduleJobs = minConfig.min_schedule_jobs ?? 5
  const minFeedbackCount = minConfig.min_feedback_count ?? 3
  const minSafetyRecords = minConfig.min_safety_records ?? 1
  const minReworkRecords = minConfig.min_rework_records ?? 1

  // Filter out vendors that don't meet minimum data requirements
  const allScores = scoresRes.data || []
  const filteredScores = allScores.filter(s => {
    if (s.schedule_score != null && (s.schedule_total_jobs ?? 0) < minScheduleJobs) return false
    if (s.feedback_score != null && (s.feedback_count ?? 0) < minFeedbackCount) return false
    if (s.safety_score != null && minSafetyRecords > 0 && (s.safety_incident_count ?? 0) < minSafetyRecords) return false
    if (s.rework_score != null && minReworkRecords > 0 && (s.rework_count ?? 0) < minReworkRecords) return false
    return true
  })

  console.log(`${allScores.length} total vendors, ${filteredScores.length} meet minimum data requirements`)

  const permit = await loadPermitData()

  return {
    scores: filteredScores,
    feedback: feedbackRes.data || [],
    weights: weightsRes.data,
    priorScores,
    priorSnapshotName: snapshots[0]?.name || null,
    permit,
  }
}

// ---- Permit outlook (workload leading indicator) ----------------------------
// Loads the most recent permit import + its normalized series. The latest import
// carries the full trailing window, so it is the source of truth for the brief.
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

function fmtMonthLong(monthStr) {
  const [y, m] = String(monthStr).split('-').map(Number)
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${names[m - 1]} ${y}`
}

function pctStr(v) {
  if (v == null || !Number.isFinite(v)) return ''
  return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(0)}%`
}

// Trailing-12 / prior-12 / YoY for one scope (total | region | builder).
function summarizePermitScope(series, scopeType) {
  const months = [...new Set(series.map(s => s.period_month))].sort()
  const last12 = new Set(months.slice(-12))
  const prior12 = new Set(months.slice(-24, -12))
  const byName = {}
  for (const r of series) {
    if (r.scope_type !== scopeType) continue
    const e = byName[r.scope_name] || (byName[r.scope_name] = { name: r.scope_name, t12: 0, p12: 0 })
    if (last12.has(r.period_month)) e.t12 += r.permits
    else if (prior12.has(r.period_month)) e.p12 += r.permits
  }
  return Object.values(byName).map(e => ({
    ...e,
    yoy: e.p12 > 0 ? (e.t12 / e.p12) - 1 : null,
  }))
}

// Latest-month deviation vs the normal band — the "out of the norm" signal that
// tells trade managers to add or claw back capacity. Mirrors the app's σ method.
function permitDeviation(series) {
  const months = [...new Set(series.map(s => s.period_month))].sort()
  const byMonth = new Map(series.filter(s => s.scope_type === 'total').map(s => [s.period_month, s.permits]))
  const arr = months.map(mo => byMonth.get(mo) || 0)
  if (arr.length < 5) return null
  const base = arr.slice(0, -1)
  const mu = base.reduce((a, x) => a + x, 0) / base.length
  const sd = Math.sqrt(base.reduce((a, x) => a + (x - mu) ** 2, 0) / (base.length - 1))
  if (!sd) return null
  const latest = arr[arr.length - 1]
  return { month: months[months.length - 1], latest, mean: mu, z: (latest - mu) / sd }
}

function buildPermitBrief(permit) {
  if (!permit) return null
  const { series, meta } = permit
  const total = summarizePermitScope(series, 'total')[0]
  if (!total || total.t12 === 0) return null

  const momentum = total.p12 > 0 ? Math.min(2, Math.max(0.5, total.t12 / total.p12)) : 1
  const forecast12 = Math.round(total.t12 * momentum)

  const regions = summarizePermitScope(series, 'region').filter(r => r.t12 >= 1000 && r.yoy != null)
  regions.sort((a, b) => b.yoy - a.yoy)
  const strongest = regions[0]
  const softest = regions[regions.length - 1]

  const builders = summarizePermitScope(series, 'builder').filter(b => b.t12 >= 500 && b.yoy != null)
  builders.sort((a, b) => b.yoy - a.yoy)
  const movers = builders.slice(0, 2)

  const lines = []
  lines.push('PERMIT PULSE — TRADE-BASE CAPACITY')
  lines.push('-'.repeat(40))
  lines.push(`Through ${fmtMonthLong(meta.report_month)}: ${total.t12.toLocaleString()} permits in the trailing 12 months (${pctStr(total.yoy) || 'n/a'} YoY). Forecast next 12 months ~${forecast12.toLocaleString()}.`)

  // Deviation / anomaly call-out — the actionable signal.
  const dev = permitDeviation(series)
  if (dev) {
    const sigmas = Math.abs(dev.z).toFixed(1)
    if (dev.z >= 2) {
      lines.push(`SURGE: ${fmtMonthLong(dev.month)} starts came in ${dev.latest.toLocaleString()} — ${sigmas}σ ABOVE normal. Book more trade capacity now before crews get stretched and walk.`)
    } else if (dev.z <= -2) {
      lines.push(`SLOWDOWN: ${fmtMonthLong(dev.month)} starts came in ${dev.latest.toLocaleString()} — ${sigmas}σ BELOW normal. Renegotiate / claw back trade commitments before the gap hits site.`)
    } else {
      lines.push(`Latest month (${fmtMonthLong(dev.month)}): ${dev.latest.toLocaleString()} starts, ${dev.z >= 0 ? '+' : '-'}${sigmas}σ vs normal (within range).`)
    }
  }

  if (strongest && softest && strongest.name !== softest.name) {
    lines.push(`Strongest region: ${strongest.name} ${strongest.t12.toLocaleString()} (${pctStr(strongest.yoy)}); softest: ${softest.name} ${softest.t12.toLocaleString()} (${pctStr(softest.yoy)}).`)
  }
  if (movers.length > 0) {
    lines.push(`Builder momentum: ${movers.map(m => `${m.name} ${m.t12.toLocaleString()} (${pctStr(m.yoy)})`).join(', ')} ramping up.`)
  }
  lines.push('A permit today is trade work over the next ~6-9 months — data lags ~1 month but still leads on-site demand. Filter by your peer builders + region in the app for a sharper read.')
  lines.push('')
  return lines.join('\n')
}

// Per-region latest-month surge vs each region's own normal band. Regions
// running >= 0.5σ hot signal POTENTIAL future trade demand — a permit is a
// leading indicator that lags ~1 month and lands on-site over the next ~6-9
// months, so this is a forward signal, not a guarantee. The month shown is the
// permit reporting month (meta.report_month) — the same month Permit Pulse
// reports "through" — not the month demand actually arrives. Auto-updates as
// new permit imports land: loadPermitData always reads the newest one.
function buildDemandOutlook(permit) {
  if (!permit) return null
  const { series, meta } = permit
  const months = [...new Set(series.map(s => s.period_month))].sort()
  if (months.length < 5) return null

  const byRegion = new Map()
  for (const r of series) {
    if (r.scope_type !== 'region') continue
    let m = byRegion.get(r.scope_name)
    if (!m) { m = new Map(); byRegion.set(r.scope_name, m) }
    m.set(r.period_month, (m.get(r.period_month) || 0) + r.permits)
  }

  const surges = []
  for (const [name, m] of byRegion) {
    const arr = months.map(mo => m.get(mo) || 0)
    const base = arr.slice(0, -1)
    const mu = base.reduce((a, x) => a + x, 0) / base.length
    const sd = Math.sqrt(base.reduce((a, x) => a + (x - mu) ** 2, 0) / (base.length - 1))
    if (!sd || mu <= 0) continue
    const latest = arr[arr.length - 1]
    const z = (latest - mu) / sd
    if (z >= 0.5) surges.push({ name, pctAbove: (latest - mu) / mu })
  }
  if (surges.length === 0) return null
  surges.sort((a, b) => b.pctAbove - a.pctAbove)

  // Month label comes straight from the permit data (report_month), matching
  // Permit Pulse; fall back to the latest series month if meta is missing.
  const permitMonth = fmtMonthLong(meta?.report_month || months[months.length - 1])

  const lines = []
  lines.push('ANTICIPATED VENDOR DEMAND BASED ON PERMIT DATA')
  lines.push('-'.repeat(40))
  lines.push('POTENTIAL for increased trade demand ahead — a forward signal, not a')
  lines.push('certainty. Consider lining up crew capacity where permits are surging.')
  lines.push('')
  lines.push(`  ${'Permit Month'.padEnd(14)}${'Region'.padEnd(24)}% Above Normal`)
  for (const s of surges) {
    lines.push(`  ${permitMonth.padEnd(14)}${s.name.padEnd(24)}${pctStr(s.pctAbove)}`)
  }
  lines.push('')
  return lines.join('\n')
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
  const priorValid = priorScores.filter(s => s.weighted_total != null)
  if (priorValid.length > 0) {
    const priorAvg = priorValid.reduce((a, s) => a + Number(s.weighted_total), 0) / priorValid.length
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

function buildEmail({ scores, feedback, weights, priorScores, priorSnapshotName, permit }) {
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

  const permitBrief = buildPermitBrief(permit)
  if (permitBrief) lines.push(permitBrief)

  const demandOutlook = buildDemandOutlook(permit)
  if (demandOutlook) lines.push(demandOutlook)

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
