const { createClient } = require('@supabase/supabase-js')

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

async function main() {
  const date = new Date()
  const label = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const snapshotName = `Week ending ${label}`

  console.log(`Creating snapshot: "${snapshotName}"`)

  const [scoresRes, weightsRes, filesRes] = await Promise.all([
    supabase.from('score_results').select('*, vendors(name, vendor_categories(name))'),
    supabase.from('score_weights').select('*').eq('is_current', true).single(),
    supabase.from('uploaded_files').select('id, original_filename, file_type'),
  ])

  const scores = scoresRes.data || []
  const weights = weightsRes.data
  const files = filesRes.data || []

  console.log(`Loaded ${scores.length} scores, ${files.length} file refs`)

  const { data: snapshot, error: snapError } = await supabase
    .from('snapshots')
    .insert({
      name: snapshotName,
      description: 'Auto-generated weekly snapshot',
      notes: `Automatically taken every Friday at 6pm ET by GitHub Actions.`,
      created_by: null,
    })
    .select()
    .single()

  if (snapError) throw new Error('Failed to create snapshot: ' + snapError.message)
  console.log(`Snapshot created: ${snapshot.id}`)

  if (scores.length) {
    const { error: scoresError } = await supabase.from('snapshot_score_results').insert(
      scores.map(s => ({
        snapshot_id: snapshot.id,
        vendor_id: s.vendor_id,
        vendor_name: s.vendors?.name || 'Unknown',
        category_name: s.vendors?.vendor_categories?.name || '',
        safety_score: s.safety_score,
        schedule_score: s.schedule_score,
        rework_score: s.rework_score,
        feedback_score: s.feedback_score,
        safety_incident_count: s.safety_incident_count,
        schedule_total_jobs: s.schedule_total_jobs,
        schedule_no_shows: s.schedule_no_shows,
        rework_count: s.rework_count,
        feedback_count: s.feedback_count,
        weighted_total: s.weighted_total,
        overall_rank: s.overall_rank,
        category_rank: s.category_rank,
      }))
    )
    if (scoresError) throw new Error('Failed to insert scores: ' + scoresError.message)
    console.log(`Inserted ${scores.length} score records`)
  }

  if (weights) {
    const { error: weightsError } = await supabase.from('snapshot_weights').insert({
      snapshot_id: snapshot.id,
      safety_weight: weights.safety_weight,
      schedule_weight: weights.schedule_weight,
      inspections_weight: weights.inspections_weight,
      rework_weight: weights.rework_weight,
      warranty_weight: weights.warranty_weight,
      feedback_weight: weights.feedback_weight,
    })
    if (weightsError) throw new Error('Failed to insert weights: ' + weightsError.message)
  }

  if (files.length) {
    const { error: filesError } = await supabase.from('snapshot_file_refs').insert(
      files.map(f => ({
        snapshot_id: snapshot.id,
        uploaded_file_id: f.id,
        file_type: f.file_type,
        original_filename: f.original_filename,
      }))
    )
    if (filesError) throw new Error('Failed to insert file refs: ' + filesError.message)
  }

  console.log(`Snapshot "${snapshotName}" completed successfully.`)
}

main().catch(err => {
  console.error('Snapshot failed:', err.message)
  process.exit(1)
})
