import { useState, useCallback } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useTeamData } from '../hooks/useTeamData'
import { logActivity } from '../hooks/useActivityLog'
import { Users, GripVertical, MapPin, AlertCircle, RefreshCw } from 'lucide-react'
import { cn } from '../lib/cn'

const DRAG_BUILDER = 'application/x-vtc-builder-id'

export default function TeamsPage() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const {
    teams,
    loading,
    error,
    reload,
    moveBuilderToAcm,
    clearBuilderAcm,
    assignCommunity,
    removeCommunity,
    promoteToFrontEnd,
    demoteFromFrontEnd,
  } = useTeamData()

  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState(false)
  const [draggingId, setDraggingId] = useState(null)
  const [dropTarget, setDropTarget] = useState(null)

  const runAction = useCallback(async (fn, logDesc, logMeta) => {
    setActionError('')
    setBusy(true)
    try {
      await fn()
      if (logDesc) logActivity('team_assignment_changed', logDesc, logMeta).catch(() => {})
    } catch (err) {
      console.error('Teams action error:', err)
      setActionError(err.message || 'Something went wrong.')
    } finally {
      setBusy(false)
      setDraggingId(null)
      setDropTarget(null)
    }
  }, [])

  function handleDragStart(e, builderId) {
    if (!isAdmin || busy) {
      e.preventDefault()
      return
    }
    e.dataTransfer.setData(DRAG_BUILDER, builderId)
    e.dataTransfer.effectAllowed = 'move'
    setDraggingId(builderId)
  }

  function handleDragEnd() {
    setDraggingId(null)
    setDropTarget(null)
  }

  function allowDrop(e) {
    if (!isAdmin || busy) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  async function handleDropOnAcm(e, acmId, acmName) {
    e.preventDefault()
    if (!isAdmin || busy) return
    const builderId = e.dataTransfer.getData(DRAG_BUILDER)
    if (!builderId) return
    const builder = [...teams.grouped.flatMap(g => g.builders), ...teams.unassigned]
      .find(b => b.id === builderId)
    if (!builder || builder.acm_id === acmId) return
    await runAction(
      () => moveBuilderToAcm(builderId, acmId),
      `Moved ${builder.full_name || 'builder'} to ACM ${acmName}`,
      { builder_id: builderId, acm_id: acmId }
    )
  }

  async function handleDropOnCommunity(e, communityId, communityName) {
    e.preventDefault()
    if (!isAdmin || busy) return
    const builderId = e.dataTransfer.getData(DRAG_BUILDER)
    if (!builderId) return
    const builder = [...teams.grouped.flatMap(g => g.builders), ...teams.unassigned]
      .find(b => b.id === builderId)
    if (!builder) return
    if (builder.assignments.some(a => a.community_id === communityId)) return
    await runAction(
      () => assignCommunity(builderId, communityId),
      `Assigned ${builder.full_name || 'builder'} to ${communityName}`,
      { builder_id: builderId, community_id: communityId }
    )
  }

  async function handleDropUnassigned(e) {
    e.preventDefault()
    if (!isAdmin || busy) return
    const builderId = e.dataTransfer.getData(DRAG_BUILDER)
    if (!builderId) return
    const builder = teams.grouped.flatMap(g => g.builders).find(b => b.id === builderId)
    if (!builder) return
    await runAction(
      () => clearBuilderAcm(builderId),
      `Removed ${builder.full_name || 'builder'} from ACM assignment`,
      { builder_id: builderId }
    )
  }

  async function handleRemoveCommunity(builder, communityId, communityName) {
    await runAction(
      () => removeCommunity(builder.id, communityId),
      `Removed ${builder.full_name || 'builder'} from ${communityName}`,
      { builder_id: builder.id, community_id: communityId }
    )
  }

  async function handlePromoteToFrontEnd(builder) {
    await runAction(
      () => promoteToFrontEnd(builder.id),
      `Promoted ${builder.full_name || 'builder'} to front-end`,
      { builder_id: builder.id }
    )
  }

  async function handleDemoteFromFrontEnd(builder) {
    await runAction(
      () => demoteFromFrontEnd(builder.id),
      `Removed front-end status from ${builder.full_name || 'builder'}`,
      { builder_id: builder.id }
    )
  }

  const totalBuilders = teams.grouped.reduce((n, g) => n + g.builders.length, 0) + teams.unassigned.length

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Users className="w-6 h-6 text-teal-600" />
            Teams
          </h1>
          <p className="glass-page-subtitle">
            Area construction managers and builder community assignments
          </p>
        </div>
        <button
          type="button"
          onClick={reload}
          disabled={loading || busy}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg border border-gray-200 bg-white"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {isAdmin && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
          <strong>Admin:</strong> Drag builders onto an ACM or community to reassign.
          Use <strong>Promote to front-end</strong> to allow a second community. Disable builders in Admin → User Management to remove them from this page.
        </div>
      )}

      {(error || actionError) && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          {actionError || error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" />
        </div>
      ) : totalBuilders === 0 && teams.grouped.length === 0 ? (
        <div className="glass-panel p-16 text-center">
          <Users className="w-12 h-12 mx-auto mb-3 text-teal-200" />
          <p className="text-sm font-medium text-gray-700">No teams configured yet</p>
          <p className="text-xs text-gray-400 mt-1 max-w-md mx-auto">
            Mark users as Area Managers and Builders in Admin → User Management, then assign communities on the Community Map tab.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {teams.grouped.map(acm => (
            <AcmCard
              key={acm.id}
              acm={acm}
              isAdmin={isAdmin}
              busy={busy}
              draggingId={draggingId}
              dropTarget={dropTarget}
              setDropTarget={setDropTarget}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              allowDrop={allowDrop}
              onDropAcm={handleDropOnAcm}
              onDropCommunity={handleDropOnCommunity}
              onRemoveCommunity={handleRemoveCommunity}
              onPromoteToFrontEnd={handlePromoteToFrontEnd}
              onDemoteFromFrontEnd={handleDemoteFromFrontEnd}
            />
          ))}

          {(teams.unassigned.length > 0 || isAdmin) && (
            <UnassignedSection
              builders={teams.unassigned}
              isAdmin={isAdmin}
              busy={busy}
              draggingId={draggingId}
              dropTarget={dropTarget}
              setDropTarget={setDropTarget}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              allowDrop={allowDrop}
              onDrop={handleDropUnassigned}
              onRemoveCommunity={handleRemoveCommunity}
              onPromoteToFrontEnd={handlePromoteToFrontEnd}
              onDemoteFromFrontEnd={handleDemoteFromFrontEnd}
            />
          )}
        </div>
      )}
    </div>
  )
}

function AcmCard({
  acm,
  isAdmin,
  busy,
  draggingId,
  dropTarget,
  setDropTarget,
  onDragStart,
  onDragEnd,
  allowDrop,
  onDropAcm,
  onDropCommunity,
  onRemoveCommunity,
  onPromoteToFrontEnd,
  onDemoteFromFrontEnd,
}) {
  const acmDropId = `acm-${acm.id}`
  const isAcmTarget = dropTarget === acmDropId

  return (
    <div
      className={cn(
        'glass-panel overflow-hidden transition-shadow',
        isAcmTarget && 'ring-2 ring-teal-400'
      )}
      onDragOver={e => { allowDrop(e); if (isAdmin) setDropTarget(acmDropId) }}
      onDragLeave={() => { if (dropTarget === acmDropId) setDropTarget(null) }}
      onDrop={e => { setDropTarget(null); onDropAcm(e, acm.id, acm.full_name || acm.email) }}
    >
      <div className="px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-teal-50/80 to-transparent">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">
              {acm.full_name || acm.email}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">Area Construction Manager</p>
          </div>
          <div className="flex gap-2 text-xs">
            <span className="px-2 py-1 rounded-full bg-teal-100 text-teal-800 font-medium">
              {acm.communities.length} {acm.communities.length === 1 ? 'community' : 'communities'}
            </span>
            <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-600 font-medium">
              {acm.builders.length} {acm.builders.length === 1 ? 'builder' : 'builders'}
            </span>
          </div>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {acm.communities.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">
              Communities {isAdmin && <span className="normal-case font-normal">— drop a builder here</span>}
            </p>
            <div className="flex flex-wrap gap-2">
              {acm.communities.map(c => {
                const dropId = `comm-${c.id}`
                const assigned = acm.builders.filter(b =>
                  b.assignments.some(a => a.community_id === c.id)
                )
                return (
                  <div
                    key={c.id}
                    onDragOver={e => { allowDrop(e); if (isAdmin) setDropTarget(dropId) }}
                    onDragLeave={() => { if (dropTarget === dropId) setDropTarget(null) }}
                    onDrop={e => { setDropTarget(null); onDropCommunity(e, c.id, c.name) }}
                    className={cn(
                      'min-w-[140px] rounded-lg border px-3 py-2 transition-colors',
                      dropTarget === dropId
                        ? 'border-teal-400 bg-teal-50'
                        : 'border-gray-200 bg-gray-50/80'
                    )}
                  >
                    <div className="flex items-center gap-1.5 text-xs font-medium text-gray-800">
                      <MapPin className="w-3 h-3 text-teal-600 flex-shrink-0" />
                      <span className="truncate">{c.name}</span>
                      {c.code && <span className="font-mono text-[10px] text-gray-400">{c.code}</span>}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {assigned.length === 0 ? (
                        <span className="text-[10px] text-gray-400 italic">No builder</span>
                      ) : (
                        assigned.map(b => (
                          <span key={b.id} className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-gray-200 text-gray-700">
                            {b.full_name || b.email}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {acm.communities.length === 0 && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            No communities assigned to this ACM yet. Assign communities in Admin → Community Map.
          </p>
        )}

        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Builders</p>
          {acm.builders.length === 0 ? (
            <p className="text-xs text-gray-400 italic py-2">
              {isAdmin ? 'Drag a builder here to assign to this ACM.' : 'No builders assigned.'}
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {acm.builders.map(builder => (
                <BuilderCard
                  key={builder.id}
                  builder={builder}
                  isAdmin={isAdmin}
                  busy={busy}
                  isDragging={draggingId === builder.id}
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                  onRemoveCommunity={onRemoveCommunity}
                  onPromoteToFrontEnd={onPromoteToFrontEnd}
                  onDemoteFromFrontEnd={onDemoteFromFrontEnd}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function UnassignedSection({
  builders,
  isAdmin,
  busy,
  draggingId,
  dropTarget,
  setDropTarget,
  onDragStart,
  onDragEnd,
  allowDrop,
  onDrop,
  onRemoveCommunity,
  onPromoteToFrontEnd,
  onDemoteFromFrontEnd,
}) {
  const dropId = 'unassigned'
  const isTarget = dropTarget === dropId

  if (!isAdmin && builders.length === 0) return null

  return (
    <div
      className={cn(
        'glass-panel p-5 border-dashed transition-shadow',
        isTarget ? 'ring-2 ring-gray-400 border-gray-300' : 'border-gray-200'
      )}
      onDragOver={e => { allowDrop(e); if (isAdmin) setDropTarget(dropId) }}
      onDragLeave={() => { if (dropTarget === dropId) setDropTarget(null) }}
      onDrop={e => { setDropTarget(null); onDrop(e) }}
    >
      <p className="text-sm font-medium text-gray-700 mb-1">Unassigned Builders</p>
      <p className="text-xs text-gray-400 mb-3">
        {isAdmin
          ? 'Builders not linked to an ACM, or drag here to remove ACM assignment.'
          : 'Builders waiting for ACM assignment.'}
      </p>
      {builders.length === 0 ? (
        <p className="text-xs text-gray-400 italic">None</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {builders.map(builder => (
            <BuilderCard
              key={builder.id}
              builder={builder}
              isAdmin={isAdmin}
              busy={busy}
              isDragging={draggingId === builder.id}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onRemoveCommunity={onRemoveCommunity}
              onPromoteToFrontEnd={onPromoteToFrontEnd}
              onDemoteFromFrontEnd={onDemoteFromFrontEnd}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function BuilderCard({
  builder,
  isAdmin,
  busy,
  isDragging,
  onDragStart,
  onDragEnd,
  onRemoveCommunity,
  onPromoteToFrontEnd,
  onDemoteFromFrontEnd,
}) {
  const name = builder.full_name || builder.email
  const isFrontEnd = builder.is_front_end_builder

  return (
    <div
      draggable={isAdmin && !busy}
      onDragStart={e => onDragStart(e, builder.id)}
      onDragEnd={onDragEnd}
      className={cn(
        'flex items-start gap-2 rounded-lg border bg-white px-3 py-2.5 transition-opacity',
        isFrontEnd && 'border-violet-200 bg-violet-50/30',
        isAdmin && !busy && 'cursor-grab active:cursor-grabbing hover:border-teal-300 hover:shadow-sm',
        isDragging && 'opacity-40',
        busy && 'pointer-events-none opacity-60'
      )}
    >
      {isAdmin && <GripVertical className="w-4 h-4 text-gray-300 flex-shrink-0 mt-0.5" />}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <p className="text-sm font-medium text-gray-900 truncate">{name}</p>
          {isFrontEnd && (
            <span className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-violet-100 text-violet-700">
              Front-end
            </span>
          )}
        </div>
        {builder.assignments.length === 0 ? (
          <p className="text-[10px] text-gray-400 mt-1 italic">No community assigned</p>
        ) : (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {builder.assignments.map(a => (
              <span
                key={a.community_id}
                className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-teal-50 text-teal-800 border border-teal-100"
              >
                {a.community?.name}
                {a.assignment_type === 'secondary' && (
                  <span className="text-violet-500 font-medium">(2nd)</span>
                )}
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => onRemoveCommunity(builder, a.community_id, a.community?.name)}
                    className="ml-0.5 text-teal-400 hover:text-red-500 leading-none"
                    title="Remove from community"
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
        {isAdmin && (
          <div className="mt-2">
            {isFrontEnd ? (
              <button
                type="button"
                onClick={() => onDemoteFromFrontEnd(builder)}
                className="text-[10px] text-violet-600 hover:text-violet-800 underline"
              >
                Remove front-end status
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onPromoteToFrontEnd(builder)}
                className="text-[10px] text-teal-600 hover:text-teal-800 underline"
              >
                Promote to front-end
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
