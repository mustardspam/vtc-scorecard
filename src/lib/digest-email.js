// Single source of truth for the weekly digest email body.
//
// BOTH the server-side sender (scripts/send-digest.js, run by GitHub Actions)
// and the in-app preview (src/pages/DigestPage.jsx) import buildDigestText from
// here, so the delivered email and the website preview can never drift. Keep
// this module pure: plain data in, a string out. No React, no supabase client,
// no Node/browser-only APIs — it has to run in both a bundler and a bare Node
// script.
//
// Callers are responsible only for FETCHING the raw rows (they use different
// data layers) and passing them in the shape documented on buildDigestText.

import { regionDemandSurges } from './permit-forecast.js'

export const TIER_THRESHOLDS = { good: 85, watch: 70, probation: 50 }
export const MIN_DEFAULTS = { min_schedule_jobs: 5, min_feedback_count: 3, min_safety_records: 1, min_rework_records: 1 }

export function getTier(score, thresholds = TIER_THRESHOLDS) {
  if (score == null) return null
  const s = Number(score)
  if (s >= thresholds.good) return 'Good'
  if (s >= thresholds.watch) return 'Watch'
  if (s >= thresholds.probation) return 'Probation'
  return 'Critical'
}

// Drop vendors that don't clear the configured minimum-data bars for whichever
// component scores they have. Mirrors the app's hasEnoughData gate.
export function filterScores(scores, min = MIN_DEFAULTS) {
  return (scores || []).filter(s => {
    if (s.schedule_score != null && (s.schedule_total_jobs ?? 0) < min.min_schedule_jobs) return false
    if (s.feedback_score != null && (s.feedback_count ?? 0) < min.min_feedback_count) return false
    if (s.safety_score != null && min.min_safety_records > 0 && (s.safety_incident_count ?? 0) < min.min_safety_records) return false
    if (s.rework_score != null && min.min_rework_records > 0 && (s.rework_count ?? 0) < min.min_rework_records) return false
    return true
  })
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

function buildExecutiveSummary({ valid, feedback, priorScores, priorSnapshotName, thresholds }) {
  if (valid.length === 0) return null

  const avg = valid.reduce((a, s) => a + Number(s.weighted_total), 0) / valid.length
  const tierCounts = { Good: 0, Watch: 0, Probation: 0, Critical: 0 }
  for (const s of valid) { const t = getTier(Number(s.weighted_total), thresholds); if (t) tierCounts[t]++ }

  const kudos = feedback.filter(f => f.category === 'kudos').length
  const complaints = feedback.filter(f => f.category === 'complaint').length

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

  const lines = []
  lines.push('EXECUTIVE SUMMARY')
  lines.push('-'.repeat(40))

  const priorValid = priorScores.filter(s => s.weighted_total != null)
  if (priorValid.length > 0) {
    const priorAvg = priorValid.reduce((a, s) => a + Number(s.weighted_total), 0) / priorValid.length
    const avgDiff = avg - priorAvg
    const sign = avgDiff >= 0 ? '+' : ''

    const priorTierMap = {}
    for (const s of priorScores) priorTierMap[s.vendor_name] = getTier(Number(s.weighted_total), thresholds)

    const movedIn = []
    const movedOut = []
    for (const s of valid) {
      const name = s.vendors?.name
      const nowTier = getTier(Number(s.weighted_total), thresholds)
      const wasTier = priorTierMap[name]
      if (!wasTier || wasTier === nowTier) continue
      if (nowTier === 'Critical') movedIn.push(name)
      if (wasTier === 'Critical' && nowTier !== 'Critical') movedOut.push(name)
    }

    const label = priorSnapshotName ? `vs snapshot "${priorSnapshotName}"` : 'vs prior snapshot'
    let weekLine = `Week over week (${label}): Overall average ${avgDiff >= 0 ? 'rose' : 'fell'} ${sign}${Math.abs(avgDiff).toFixed(1)} pts to ${avg.toFixed(1)}.`
    if (movedIn.length > 0) weekLine += ` ${movedIn.join(', ')} moved into Critical.`
    if (movedOut.length > 0) weekLine += ` ${movedOut.join(', ')} improved out of Critical.`
    if (movedIn.length === 0 && movedOut.length === 0) weekLine += ' No vendors changed Critical status.'
    lines.push(weekLine)
  } else {
    lines.push(`This week: Overall average is ${avg.toFixed(1)} across ${valid.length} scored vendors. ${tierCounts.Critical} critical, ${tierCounts.Probation} on probation, ${tierCounts.Good} in good standing.`)
  }

  let thirtyLine = `Last 30 days: ${kudos + complaints} feedback submissions received — ${kudos} kudos, ${complaints} complaints`
  thirtyLine += kudos > complaints ? ' (kudos outpacing complaints).' : complaints > kudos ? ' (complaints outpacing kudos — worth reviewing).' : ' (even split).'
  if (topCat && bottomCat && topCat.name !== bottomCat.name) {
    thirtyLine += ` ${topCat.name} leads all categories at ${topCat.avg.toFixed(1)}; ${bottomCat.name} is the lowest at ${bottomCat.avg.toFixed(1)}.`
  }
  if (tierCounts.Critical + tierCounts.Probation > 0) {
    thirtyLine += ` ${tierCounts.Critical + tierCounts.Probation} vendor${tierCounts.Critical + tierCounts.Probation > 1 ? 's' : ''} currently in Critical or Probation status.`
  }
  lines.push(thirtyLine)
  lines.push('')
  return lines.join('\n')
}

// Per-region latest-month permit surge, framed as a POTENTIAL forward signal.
// Month + region labels come straight from the permit data (same source as the
// Permits page filter), so it auto-updates with each monthly import.
function buildDemandOutlook({ permitSeries, permitMeta }) {
  const surges = regionDemandSurges(permitSeries || [], { sigma: 0.5 })
  if (!surges.length) return null

  const months = [...new Set((permitSeries || []).map(s => s.period_month))].sort()
  const permitMonth = fmtMonthLong(permitMeta?.report_month || surges[0].month || months[months.length - 1])

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

/**
 * Build the full plain-text digest body.
 *
 * @param {object} data
 * @param {Array}  data.scores        raw score_results rows (unfiltered) with
 *                                    `weighted_total` and `vendors{name, vendor_categories{name}}`
 * @param {Array}  data.feedback      approved feedback rows {category, severity, vendors{name}, submitter{full_name}}
 * @param {object} data.weights       current score_weights row (optional)
 * @param {Array}  data.priorScores   prior snapshot rows {vendor_name, weighted_total}
 * @param {string} data.priorSnapshotName
 * @param {Array}  data.permitSeries  normalized permit_series rows
 * @param {object} data.permitMeta    latest permit import {report_month}
 * @param {object} data.thresholds    tier cutoffs {good, watch, probation}
 * @param {object} data.minThresholds min-data cutoffs (see MIN_DEFAULTS)
 * @param {Date}   data.now           timestamp for the header/footer (defaults to now)
 * @returns {string}
 */
export function buildDigestText(data) {
  const {
    scores = [], feedback = [], weights = null,
    priorScores = [], priorSnapshotName = null,
    permitSeries = [], permitMeta = null,
    thresholds = TIER_THRESHOLDS, minThresholds = MIN_DEFAULTS,
    now = new Date(),
  } = data || {}

  const filtered = filterScores(scores, minThresholds)
  const valid = filtered.filter(s => s.weighted_total != null)
    .sort((a, b) => Number(b.weighted_total) - Number(a.weighted_total))

  const tierCounts = { Good: 0, Watch: 0, Probation: 0, Critical: 0 }
  for (const s of valid) { const t = getTier(Number(s.weighted_total), thresholds); if (t) tierCounts[t]++ }
  const avg = valid.length
    ? (valid.reduce((a, s) => a + Number(s.weighted_total), 0) / valid.length).toFixed(1)
    : '—'

  const critical = valid.filter(s => getTier(Number(s.weighted_total), thresholds) === 'Critical')
  const probation = valid.filter(s => getTier(Number(s.weighted_total), thresholds) === 'Probation')
  const top5 = valid.slice(0, 5)
  const bottom5 = [...valid].reverse().slice(0, 5)
  const kudos = feedback.filter(f => f.category === 'kudos').slice(0, 5)
  const complaints = feedback.filter(f => f.category === 'complaint').slice(0, 5)

  const date = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const lines = []

  lines.push(`VTC SCORECARD DIGEST — ${date}`)
  lines.push('='.repeat(60))
  lines.push('')

  const summary = buildExecutiveSummary({ valid, feedback, priorScores, priorSnapshotName, thresholds })
  if (summary) lines.push(summary)

  const demand = buildDemandOutlook({ permitSeries, permitMeta })
  if (demand) lines.push(demand)

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
  lines.push(`Generated from VTC Scorecard · ${date}`)

  return lines.join('\n')
}
