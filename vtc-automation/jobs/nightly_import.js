#!/usr/bin/env node
// Nightly import entry point (Task Scheduler runs this). Does not need Claude or an MCP client.
//
//   node vtc-automation/jobs/nightly_import.js [--dry-run] [--category <name>] [--brand <name>]
//        [--date YYYY-MM-DD | --backfill <start YYYY-MM-DD> <end YYYY-MM-DD>]
//   node vtc-automation/jobs/nightly_import.js --requests
//        runs a "Refresh now" request queued from the Uploads page, if there is one
//
// Exit codes: 0 all good (or nothing to do), 1 something failed (and an email went out),
// 2 bad arguments, 3 another run is in progress.
import { pathToFileURL } from 'node:url'
import { loadConfig } from '../core/config.js'
import { createLogger } from '../core/log.js'
import { parseISODate, toISODate } from '../core/months.js'
import { loadState, acquireLock } from '../core/state.js'
import { archivePull, purgeOld } from '../core/archive.js'
import { requireCredentials } from '../core/credentials.js'
import { createResplanClient } from '../core/resplan_client.js'
import { connectScorecard, importPull } from '../core/importer.js'
import { sendMail } from '../core/notify.js'
import { runNightly, reportFailed, formatReport, resolveCategory, unitLabel, OK } from '../core/runner.js'
import { claimRequest, updateRequest, requestOutcome } from '../core/refresh_requests.js'
import { ERP_BRANDS } from '../../src/lib/importers/erp-import.js'

const USAGE = `Usage: nightly_import.js [--dry-run] [--category <schedule|rework|safety|jc_vendor_report>[,...]]
                         [--brand <Starlight|Ashton Woods>] [--date YYYY-MM-DD | --backfill START END]
       nightly_import.js --requests`

const ALL_CREDENTIALS = ['resplan-token', 'supabase-email', 'supabase-password', 'supabase-anon-key']

export function parseArgs(argv) {
  const opts = { dryRun: false, categories: null, brands: null, date: null, backfill: null }
  const date = (v, flag) => {
    if (!parseISODate(v)) throw new Error(`${flag} needs a date as YYYY-MM-DD (got "${v ?? ''}")`)
    return v
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') opts.dryRun = true
    else if (a === '--requests') opts.requests = true
    else if (a === '--category') opts.categories = [...(opts.categories || []), ...String(argv[++i] ?? '').split(',').map(resolveCategory)]
    else if (a === '--brand') {
      const b = ERP_BRANDS.find(x => x.toLowerCase() === String(argv[++i] ?? '').toLowerCase())
      if (!b) throw new Error(`--brand must be one of: ${ERP_BRANDS.join(', ')}`)
      opts.brands = [...(opts.brands || []), b]
    } else if (a === '--date') opts.date = date(argv[++i], '--date')
    else if (a === '--backfill') {
      const start = date(argv[++i], '--backfill start'), end = date(argv[++i], '--backfill end')
      if (start > end) throw new Error('--backfill start must be on or before end')
      opts.backfill = [start, end]
    } else if (a === '--help' || a === '-h') opts.help = true
    else throw new Error(`Unknown argument "${a}"`)
  }
  if (opts.date && opts.backfill) throw new Error('Use --date or --backfill, not both')
  if (opts.requests && (opts.dryRun || opts.date || opts.backfill || opts.categories || opts.brands)) {
    throw new Error('--requests takes no other options (the request says what to pull)')
  }
  return opts
}

/** Everything runNightly needs, wired to ResPlan, the scorecard and the local files. */
function liveDeps({ config, creds, log, connect }) {
  const resplan = createResplanClient({ baseUrl: config.resplanUrl, token: creds['resplan-token'], pullTimeoutMs: config.pullTimeoutMinutes * 60000 })
  return {
    log,
    state: loadState(),
    resplanListening: () => resplan.isListening(),
    pull: (unit, onStep) => resplan.pull(unit.category, unit.brand, unit.month, onStep),
    connect: connect || (() => connectScorecard({ url: config.supabaseUrl, anonKey: creds['supabase-anon-key'], email: creds['supabase-email'], password: creds['supabase-password'] })),
    importUnit: (ctx, unit, raw, progress) => importPull(ctx, unit, raw, progress),
    archive: (unit, raw, transformed) => archivePull(unit, raw, transformed),
  }
}

async function emailReport({ config, log, report, failed, force = false }) {
  if (report.dryRun || !(failed ? config.notify.onFailure : (force || config.notify.dailySummary))) return
  const what = report.trigger ? 'VTC data refresh' : 'VTC nightly import'
  const subject = failed
    ? `${what} FAILED (${report.asOf})${report.fatal ? `: ${report.fatal.slice(0, 80)}` : ''}`
    : `${what} OK (${report.asOf})`
  try {
    log.info('email_sent', { result: await sendMail({ to: config.notify.to, subject, body: formatReport(report) }) })
  } catch (err) {
    log.error('email_failed', { error: err.message })
  }
}

/** --requests: run one queued "Refresh now" request. Quiet (no log lines) when there is none. */
async function runRequest({ config, now, runId, log }) {
  const creds = await requireCredentials(ALL_CREDENTIALS)
  const scorecard = await connectScorecard({ url: config.supabaseUrl, anonKey: creds['supabase-anon-key'], email: creds['supabase-email'], password: creds['supabase-password'] })
  try {
    const request = await claimRequest(scorecard.ctx.supabase)
    if (!request) return 0
    log.info('refresh_request_claimed', { id: request.id, requestedAt: request.requested_at, categories: request.categories })
    const deps = liveDeps({
      config, creds, log,
      // Reuse this sign-in; it is closed below, after the request is updated.
      connect: async () => ({ ctx: scorecard.ctx, close: async () => {} }),
    })
    deps.onProgress = (unit, i, total) => updateRequest(scorecard.ctx.supabase, request.id, { step: `${unitLabel(unit)} (${i + 1} of ${total})` })
      .catch(err => log.warn('request_progress_failed', { error: err.message }))
    let report
    try {
      report = await runNightly({
        runId, asOf: toISODate(now), config, trigger: 'Refresh requested from the Uploads page',
        categories: request.categories?.length ? request.categories.map(resolveCategory) : null,
      }, deps)
    } catch (err) {
      report = { runId, asOf: toISODate(now), mode: 'scheduled', units: [], fatal: err.message, startedAt: now.toISOString(), finishedAt: new Date().toISOString() }
    }
    report.trigger = 'request'
    await updateRequest(scorecard.ctx.supabase, request.id, requestOutcome(report, OK))
    const failed = Boolean(report.fatal) || reportFailed(report)
    console.log('\n' + formatReport(report))
    await emailReport({ config, log, report, failed })
    return failed ? 1 : 0
  } finally {
    await scorecard.close()
  }
}

async function runScheduled({ args, config, now, runId, log }) {
  let report
  try {
    const creds = await requireCredentials(args.dryRun ? ['resplan-token'] : ALL_CREDENTIALS)
    report = await runNightly({ ...args, runId, asOf: toISODate(now), config }, liveDeps({ config, creds, log }))
  } catch (err) {
    // Setup failed before any unit ran (missing credentials, bad config...).
    log.error('run_failed', { error: err.message })
    report = { runId, asOf: toISODate(now), mode: 'scheduled', dryRun: args.dryRun, startedAt: now.toISOString(), finishedAt: new Date().toISOString(), units: [], fatal: err.message }
  }
  const failed = Boolean(report.fatal) || reportFailed(report)
  console.log('\n' + formatReport(report))
  await emailReport({ config, log, report, failed })
  return failed ? 1 : 0
}

async function main() {
  let args
  try { args = parseArgs(process.argv.slice(2)) } catch (err) {
    console.error(`${err.message}\n${USAGE}`)
    return 2
  }
  if (args.help) { console.log(USAGE); return 0 }

  const config = loadConfig()
  const now = new Date()
  const runId = `${toISODate(now)}T${now.toTimeString().slice(0, 8).replace(/:/g, '')}`
  const log = createLogger({ runId })

  // A queued request waits (stays pending) while the nightly run holds the lock.
  const lock = acquireLock()
  if (!lock) { if (!args.requests) log.warn('run_skipped', { reason: 'another run is in progress' }); return 3 }
  try {
    if (args.requests) {
      try { return await runRequest({ config, now, runId, log }) } catch (err) {
        // Checked every few minutes: log, but don't email on every failed check.
        log.error('refresh_check_failed', { error: err.message })
        return 1
      }
    }
    return await runScheduled({ args, config, now, runId, log })
  } finally {
    try {
      const purged = purgeOld(config.retentionDays)
      if (purged.archive.length || purged.logs.length) log.info('purged', purged)
    } catch (err) { log.warn('purge_failed', { error: err.message }) }
    lock.release()
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(code => process.exit(code), err => { console.error(err); process.exit(1) })
}
