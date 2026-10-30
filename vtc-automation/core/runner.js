import { erpBrandsFor } from '../../src/lib/importers/erp-import.js'
import { monthsBetween, monthOf, monthsToPull } from './months.js'
import { transform } from './transforms.js'
import { validateDataset } from './validate.js'
import { withRetry } from './retry.js'

// The nightly run: plan which (category, brand, month) units to pull, then pull,
// transform, validate, archive and import each one on its own, so one failing never
// blocks the others. Everything with side effects comes in through `deps` (tests fake them).

/** Run order: the JC report first, since it adds the vendors and ERP IDs the others match on. */
export const CATEGORIES = ['jc_vendor_report', 'schedule', 'rework', 'safety']

const ALIASES = {
  jc: 'jc_vendor_report', jc_vendor: 'jc_vendor_report', jc_vendor_report: 'jc_vendor_report',
  schedule: 'schedule', rework: 'rework', backcharges: 'rework', safety: 'safety',
}

export function resolveCategory(name) {
  const category = ALIASES[String(name).toLowerCase().replace(/[\s-]+/g, '_')]
  if (!category) throw new Error(`Unknown category "${name}". Use one of: ${CATEGORIES.join(', ')} (or jc, backcharges)`)
  return category
}

export const OK = new Set(['imported', 'empty', 'dry-run'])

/**
 * Units for a run. Scheduled runs catch up every month since the last success;
 * --date / --backfill pull exactly the months asked for. The JC report is a current
 * snapshot, not a month, so date runs leave it out unless asked for by --category.
 */
export function planUnits({ categories = null, brands = null, date = null, backfill = null, asOf, state, maxCatchUpDays }) {
  const units = []
  for (const category of CATEGORIES) {
    if (categories ? !categories.includes(category) : (category === 'jc_vendor_report' && (date || backfill))) continue
    for (const brand of erpBrandsFor(category)) {
      if (brands && !brands.includes(brand)) continue
      if (category === 'jc_vendor_report') { units.push({ category, brand, month: null }); continue }
      const months = date ? [monthOf(date)]
        : backfill ? monthsBetween(backfill[0], backfill[1])
        : monthsToPull({ asOf, lastSuccessDate: state.lastSuccessDate(category, brand), maxCatchUpDays })
      for (const month of months) units.push({ category, brand, month })
    }
  }
  return units
}

export const unitLabel = u => `${u.category} / ${u.brand}${u.month ? ` / ${u.month}` : ''}`

async function runUnit(unit, { runId, dryRun, config, deps, scorecard }) {
  const { log, state } = deps
  const what = unitLabel(unit)
  const outcome = { ...unit }
  try {
    let lastStep = ''
    const onStep = step => { if (step && step !== lastStep) { lastStep = step; log.debug('pull_step', { unit: what, step }) } }
    log.info('pull_start', { unit: what })
    const raw = await withRetry(() => deps.pull(unit, onStep), { ...config.retry, label: `pull ${what}`, log, wait: deps.wait })

    const transformed = transform(unit.category, raw)
    outcome.rawFile = deps.archive({ runId, ...unit }, raw, transformed)
    const previousCount = state.lastCount(unit.category, unit.brand, unit.month || 'all')
    const v = validateDataset(transformed, { previousCount, ...config.validation })
    outcome.count = v.count
    outcome.warnings = v.warnings
    log.info('pulled', { unit: what, rows: v.count, previousCount, valid: v.ok, warnings: v.warnings.length })
    if (v.warnings.length) log.warn('validation_warnings', { unit: what, warnings: v.warnings })
    if (!v.ok) {
      log.error('validation_failed', { unit: what, errors: v.errors })
      return { ...outcome, status: 'invalid', errors: v.errors }
    }
    if (v.count === 0) return { ...outcome, status: 'empty' }
    if (dryRun) return { ...outcome, status: 'dry-run' }

    // A retried import is safe: importing a month again replaces the earlier (or partial) batch.
    const imported = await withRetry(
      () => deps.importUnit(scorecard.ctx, unit, raw, step => log.debug('import_step', { unit: what, step })),
      { ...config.retry, label: `import ${what}`, log, wait: deps.wait },
    )
    state.recordImport(unit.category, unit.brand, unit.month || 'all', v.count)
    const unmatched = (imported.unmatched?.length || 0)
      + (imported.review?.names.filter(n => !n.vendorId && !n.tradeOnly).length || 0)
    log.info('imported', { unit: what, rows: v.count, unmatchedVendors: unmatched })
    return { ...outcome, status: 'imported', unmatched }
  } catch (err) {
    log.error('unit_failed', { unit: what, error: err.message })
    return { ...outcome, status: 'failed', error: err.message }
  }
}

/** Runs the plan. Returns a report: { runId, asOf, mode, dryRun, startedAt, finishedAt, units, fatal }. */
export async function runNightly(opts, deps) {
  const { runId, asOf, dryRun = false, config } = opts
  const { log, state } = deps
  const mode = opts.backfill ? 'backfill' : opts.date ? 'date' : 'scheduled'
  const report = { runId, asOf, mode, dryRun, startedAt: new Date().toISOString(), units: [], fatal: null }
  const units = planUnits({ ...opts, state, maxCatchUpDays: config.maxCatchUpDays })
  log.info('run_start', { mode, dryRun, asOf, units: units.map(unitLabel) })

  const failAll = message => {
    report.fatal = message
    report.units = units.map(u => ({ ...u, status: 'failed', error: message }))
    log.error('run_aborted', { error: message })
  }

  let scorecard = null
  if (!(await deps.resplanListening())) {
    failAll(`ResPlan is not running on this PC (${config.resplanUrl}). Start it (Start-ResPlan.cmd); missed days are caught up on the next run.`)
  } else if (!dryRun) {
    try {
      scorecard = await withRetry(() => deps.connect(), { ...config.retry, label: 'scorecard sign-in', log, wait: deps.wait })
    } catch (err) {
      failAll(`Could not reach the scorecard: ${err.message}`)
    }
  }

  if (!report.fatal) {
    for (const [i, unit] of units.entries()) {
      await deps.onProgress?.(unit, i, units.length)
      report.units.push(await runUnit(unit, { runId, dryRun, config, deps, scorecard }))
    }
  }

  if (!dryRun) {
    // Catch-up bookkeeping: a category / brand is done through asOf when all its units succeeded.
    if (mode === 'scheduled' && !report.fatal) {
      const groups = new Map()
      for (const u of report.units) {
        const key = `${u.category}\u0000${u.brand}`
        groups.set(key, (groups.get(key) ?? true) && OK.has(u.status))
      }
      for (const [key, ok] of groups) if (ok) state.markSuccess(...key.split('\u0000'), asOf)
    }
    state.save()
  }

  report.finishedAt = new Date().toISOString()
  const failed = report.units.filter(u => !OK.has(u.status))
  if (scorecard) {
    await scorecard.ctx.logActivity('nightly_erp_pull',
      `${opts.trigger || 'Nightly pulls (automated)'}: ${report.units.length - failed.length} of ${report.units.length} imported${failed.length ? `, ${failed.length} failed` : ''}`,
      { results: report.units.map(u => ({ type: u.category, brand: u.brand, month: u.month, ok: OK.has(u.status), status: u.status, rows: u.count, error: u.error || u.errors?.join('; ') })) })
    await scorecard.close()
  }
  log.info('run_end', {
    ok: !failed.length, failed: failed.length,
    rows: Object.fromEntries(report.units.map(u => [unitLabel(u), `${u.status}${u.count != null ? ` (${u.count})` : ''}`])),
  })
  return report
}

export const reportFailed = report => report.units.some(u => !OK.has(u.status))

/** Plain-text summary for the email. */
export function formatReport(report) {
  const lines = [
    `VTC nightly import ${report.dryRun ? '(dry run) ' : ''}- run ${report.runId}`,
    `Mode: ${report.mode}, as of ${report.asOf}. Started ${report.startedAt}, finished ${report.finishedAt}.`,
    '',
  ]
  if (report.fatal) lines.push(`Run aborted: ${report.fatal}`, '')
  for (const u of report.units) {
    const detail = u.error || u.errors?.join('; ') || (u.unmatched ? `${u.unmatched} unmatched vendor name(s) to review on the Uploads page` : '')
    lines.push(`${OK.has(u.status) ? 'OK  ' : 'FAIL'}  ${unitLabel(u)}: ${u.status}${u.count != null ? `, ${u.count} rows` : ''}${detail ? ` - ${detail}` : ''}`)
    for (const w of (u.warnings || []).slice(0, 3)) lines.push(`        warning: ${w}`)
  }
  lines.push('', 'Logs and archived pulls: %LOCALAPPDATA%\\vtc-automation\\')
  return lines.join('\n')
}
