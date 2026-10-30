import { createClient } from '@supabase/supabase-js'
import { importErpRecords, importJCVendors } from '../../src/lib/importers/erp-import.js'
import { permanent } from './retry.js'

// Imports into the VTC Scorecard through its existing import code (the same functions
// the Uploads page calls), signed in as a dedicated admin account so row-level security
// still applies and the import history shows who imported.

const TYPE_LABELS = {
  schedule: 'Schedule Data',
  safety: 'Safety Data',
  rework: 'Rework / Backcharges',
  jc_vendor_report: 'JC Vendor Report',
}

const formatDay = iso => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
const formatStamp = iso => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })

/** Same label as the Uploads page: the dates a pull covers and when it was pulled. */
export function erpPullLabel(range, pulledAt) {
  return `${range ? `${formatDay(range.from)} – ${formatDay(range.to)}, ` : ''}pulled ${formatStamp(pulledAt)}`
}

/** Signs in and checks the account may replace pulls (admin). Returns { ctx, close }. */
export async function connectScorecard({ url, anonKey, email, password }) {
  const supabase = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false },
  })
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password })
  if (error) {
    const err = new Error(`Scorecard sign-in failed: ${error.message}`)
    // Wrong password or email is permanent; a network failure is worth retrying.
    err.permanent = error.status >= 400 && error.status < 500
    throw err
  }
  const user = data.user
  const { data: profile, error: profErr } = await supabase.from('profiles').select('role, is_active').eq('id', user.id).single()
  if (profErr) throw new Error('Loading the automation account profile failed: ' + profErr.message)
  if (profile.is_active === false) throw permanent('The scorecard automation account is disabled.')
  if (profile.role !== 'admin') throw permanent(`The scorecard automation account must be an admin (it is "${profile.role}"): replacing a month's pull needs admin.`)

  const logActivity = async (actionType, description, metadata = {}) => {
    const { error: logErr } = await supabase.from('activity_log').insert({ user_id: user.id, action_type: actionType, description, metadata })
    if (logErr) console.warn('logActivity failed (non-fatal):', logErr.message)
  }
  return {
    ctx: { supabase, user, isAdmin: true, logActivity },
    async close() {
      supabase.auth.stopAutoRefresh()
      await supabase.auth.signOut().catch(() => {})
    },
  }
}

/**
 * Imports one ResPlan result exactly as the Uploads page's runErpPull does.
 * Returns { empty } | { summary, unmatched, review? }.
 */
export async function importPull(ctx, { category, brand, month }, result, progress = () => {}) {
  const label = erpPullLabel(result.range, result.pulledAt || new Date().toISOString())
  const name = `ERP pull - ${TYPE_LABELS[category]} - ${brand} - ${label}.json`
  const sourceFile = new File([JSON.stringify(result)], name, { type: 'application/json' })
  const pullInfo = {
    erp_pull: true, brand, month, pulled_at: result.pulledAt,
    range_from: result.range?.from ?? null, range_to: result.range?.to ?? null,
    automated: true,
  }

  if (category === 'jc_vendor_report') {
    const imported = await importJCVendors(ctx, {
      parsed: result, codes: new Set(result.communities.map(c => c.code)), brandName: brand, sourceFile,
      extraMapping: pullInfo, progress,
    })
    return { summary: { ...imported, errors: result.summary?.errors }, unmatched: [] }
  }
  // Nothing in the ERP for this period: leave VTC (and any earlier pull) as it is.
  if (!result.records.length) return { empty: true }
  const { unmatched, review } = await importErpRecords(ctx, category, result.records, sourceFile, pullInfo, progress)
  return { summary: result.summary, unmatched, review }
}
