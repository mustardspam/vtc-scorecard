// "Refresh now" requests queued from the Uploads page (table erp_refresh_requests,
// migration 017). The job claims the oldest pending one, runs it and writes back the outcome.

/** Claims the oldest pending request (pending -> running). Returns it, or null when there is none. */
export async function claimRequest(supabase, { staleHours = 2 } = {}) {
  // A run that died mid-request would leave it "running" and block new ones: give up on it.
  const staleBefore = new Date(Date.now() - staleHours * 3600 * 1000).toISOString()
  await supabase.from('erp_refresh_requests')
    .update({ status: 'failed', error: `Stopped responding after ${staleHours} hours`, step: null, finished_at: new Date().toISOString() })
    .eq('status', 'running').lt('started_at', staleBefore)

  const { data: pending, error } = await supabase.from('erp_refresh_requests')
    .select('id, categories, requested_by, requested_at')
    .eq('status', 'pending').order('requested_at').limit(1).maybeSingle()
  if (error) throw new Error('Checking refresh requests failed: ' + error.message)
  if (!pending) return null
  // Only claim it if it is still pending (another run may have taken it).
  const { data: claimed, error: claimErr } = await supabase.from('erp_refresh_requests')
    .update({ status: 'running', started_at: new Date().toISOString(), step: 'Starting...' })
    .eq('id', pending.id).eq('status', 'pending')
    .select('id, categories, requested_by, requested_at').maybeSingle()
  if (claimErr) throw new Error('Claiming the refresh request failed: ' + claimErr.message)
  return claimed
}

export async function updateRequest(supabase, id, fields) {
  const { error } = await supabase.from('erp_refresh_requests').update(fields).eq('id', id)
  if (error) throw new Error('Updating the refresh request failed: ' + error.message)
}

/** Final status and per-pull result for a finished run report. */
export function requestOutcome(report, ok) {
  const result = report.units.map(u => ({
    category: u.category, brand: u.brand, month: u.month, status: u.status,
    rows: u.count ?? null, error: u.error || u.errors?.join('; ') || null,
  }))
  const okCount = report.units.filter(u => ok.has(u.status)).length
  const status = report.fatal || okCount === 0 ? 'failed' : okCount < report.units.length ? 'partial' : 'done'
  return { status, result, error: report.fatal || null, step: null, finished_at: new Date().toISOString() }
}
