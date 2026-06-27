import { useState, useCallback, useMemo } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useTeamData } from '../hooks/useTeamData'
import { logActivity } from '../hooks/useActivityLog'
import { buildAcmColorMap, acmPanelStyle } from '../lib/acm-colors'
import { Users, GripVertical, MapPin, AlertCircle, RefreshCw } from 'lucide-react'
import { cn } from '../lib/cn'

const DRAG_BUILDER = 'application/x-vtc-builder-id'

function getDraggedBuilderId(e) {
  return e.dataTransfer.getData(DRAG_BUILDER) || e.dataTransfer.getData('text/plain')
}

export default function TeamsPage() {
  const { profile } = useAuth()
  const canEdit = profile?.role === 'admin'
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
    if (!canEdit || busy) {
      e.preventDefault()
      return
    }
    e.stopPropagation()
    e.dataTransfer.setData(DRAG_BUILDER, builderId)
    e.dataTransfer.setData('text/plain', builderId)
    e.dataTransfer.effectAllowed = 'move'
    setDraggingId(builderId)
  }

  function handleDragEnd() {
    setDraggingId(null)
    setDropTarget(null)
  }

  function allowDrop(e) {
    if (!canEdit || busy) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
  }

  async function handleDropOnAcm(e, acmId, acmName) {
    e.preventDefault()
    e.stopPropagation()
    if (!canEdit || busy) return
    const builderId = getDraggedBuilderId(e)
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
    e.stopPropagation()
    if (!canEdit || busy) return
    const builderId = getDraggedBuilderId(e)
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
    e.stopPropagation()
    if (!canEdit || busy) return
    const builderId = getDraggedBuilderId(e)
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
  const acmColorMap = useMemo(() => buildAcmColorMap(teams.grouped), [teams.grouped])
  const builderProps = {
    canEdit,
    busy,
    draggingId,
    onDragStart: handleDragStart,
    onDragEnd: handleDragEnd,
    onRemoveCommunity: handleRemoveCommunity,
    onPromoteToFrontEnd: handlePromoteToFrontEnd,
    onDemoteFromFrontEnd: handleDemoteFromFrontEnd,
  }

  return (
    <div className="flex flex-col h-full min-h-0 gap-2">
      <div className="flex items-center justify-between gap-3 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Users className="w-5 h-5 text-teal-600 flex-shrink-0" />
          <h1 className="text-lg font-bold text-gray-900 truncate">Teams</h1>
          {canEdit && (
            <span className="hidden sm:inline text-[10px] text-gray-400 truncate">
              Drag builders → ACM or community · Promote for 2nd community
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={reload}
          disabled={loading || busy}
          className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-700 px-2 py-1 rounded border border-gray-200 bg-white flex-shrink-0"
        >
          <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {(error || actionError) && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 bg-red-50 border border-red-200 rounded text-[11px] text-red-700 flex-shrink-0">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="truncate">{actionError || error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center flex-1">
          <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-teal-600" />
        </div>
      ) : totalBuilders === 0 && teams.grouped.length === 0 ? (
        <div className="glass-panel p-8 text-center flex-1 flex flex-col items-center justify-center">
          <Users className="w-10 h-10 mb-2 text-teal-200" />
          <p className="text-sm font-medium text-gray-700">No teams configured yet</p>
          <p className="text-xs text-gray-400 mt-1 max-w-sm">
            Mark users as Area Managers and Builders in Admin, then assign communities on Community Map.
          </p>
        </div>
      ) : (
        <div className="flex flex-1 min-h-0 gap-2">
          <div className="flex-1 min-w-0 overflow-y-auto space-y-2 pr-0.5">
            {teams.grouped.map(acm => (
              <AcmRow
                key={acm.id}
                acm={acm}
                acmColor={acmColorMap[acm.id]}
                dropTarget={dropTarget}
                setDropTarget={setDropTarget}
                allowDrop={allowDrop}
                onDropAcm={handleDropOnAcm}
                onDropCommunity={handleDropOnCommunity}
                canEdit={canEdit}
                {...builderProps}
              />
            ))}
          </div>

          {(teams.unassigned.length > 0 || canEdit) && (
            <UnassignedPanel
              builders={teams.unassigned}
              dropTarget={dropTarget}
              setDropTarget={setDropTarget}
              allowDrop={allowDrop}
              onDrop={handleDropUnassigned}
              canEdit={canEdit}
              {...builderProps}
            />
          )}
        </div>
      )}
    </div>
  )
}

function AcmRow({
  acm,
  acmColor,
  canEdit,
  dropTarget,
  setDropTarget,
  allowDrop,
  onDropAcm,
  onDropCommunity,
  ...builderProps
}) {
  const acmDropId = `acm-${acm.id}`
  const isAcmTarget = dropTarget === acmDropId
  const panelStyle = acmPanelStyle(acmColor)

  return (
    <div
      className="glass-panel flex gap-0 overflow-hidden min-h-[72px]"
      style={{ borderColor: panelStyle.borderColor }}
    >
      {/* Left: ACM + communities — drop targets only here, not on builder column */}
      <div
        className={cn(
          'flex-1 min-w-0 p-2 border-r transition-shadow',
          isAcmTarget && 'ring-2 ring-inset'
        )}
        style={{
          ...panelStyle,
          borderRightColor: acmColor ? `${acmColor}33` : undefined,
          ...(isAcmTarget && acmColor ? { boxShadow: `inset 0 0 0 2px ${acmColor}` } : {}),
        }}
        onDragOver={e => { allowDrop(e); if (canEdit) setDropTarget(acmDropId) }}
        onDragLeave={e => {
          if (!e.currentTarget.contains(e.relatedTarget)) {
            if (dropTarget === acmDropId) setDropTarget(null)
          }
        }}
        onDrop={e => { setDropTarget(null); onDropAcm(e, acm.id, acm.full_name || acm.email) }}
      >
        <div className="flex items-center gap-1.5 mb-1.5">
          {acmColor && (
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: acmColor }}
            />
          )}
          <h2 className="text-xs font-semibold text-gray-900 truncate">
            {acm.full_name || acm.email}
          </h2>
          <span className="text-[9px] text-gray-500 uppercase tracking-wide flex-shrink-0">ACM</span>
          <span className="text-[9px] text-gray-400 ml-auto flex-shrink-0">
            {acm.communities.length}c · {acm.builders.length}b
          </span>
        </div>

        {acm.communities.length === 0 ? (
          <p className="text-[10px] text-amber-600 italic">
            {canEdit ? 'Drop a builder here to assign to this ACM' : 'No communities — assign in Community Map'}
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1">
            {acm.communities.map(c => (
              <CommunityDrop
                key={c.id}
                community={c}
                builders={acm.builders}
                acmColor={acmColor}
                dropTarget={dropTarget}
                setDropTarget={setDropTarget}
                allowDrop={allowDrop}
                onDropCommunity={onDropCommunity}
                canEdit={canEdit}
              />
            ))}
          </div>
        )}
      </div>

      {/* Right: builder stack — drag sources only, no drop handlers */}
      <div className="w-40 sm:w-44 flex-shrink-0 p-1.5 bg-gray-50/60 flex flex-col gap-0.5">
        <p className="text-[8px] font-semibold uppercase tracking-wider text-gray-400 px-0.5 mb-0.5">
          Builders
        </p>
        {acm.builders.length === 0 ? (
          <p className="text-[9px] text-gray-400 italic px-0.5 py-1">—</p>
        ) : (
          acm.builders.map(builder => (
            <BuilderTile key={builder.id} builder={builder} compact {...builderProps} />
          ))
        )}
      </div>
    </div>
  )
}

function CommunityDrop({
  community: c,
  builders,
  acmColor,
  canEdit,
  dropTarget,
  setDropTarget,
  allowDrop,
  onDropCommunity,
}) {
  const dropId = `comm-${c.id}`
  const assigned = builders.filter(b => b.assignments.some(a => a.community_id === c.id))
  const label = c.code || c.name
  const isTarget = dropTarget === dropId

  return (
    <div
      title={c.name}
      onDragOver={e => { allowDrop(e); if (canEdit) setDropTarget(dropId) }}
      onDragLeave={e => {
        if (!e.currentTarget.contains(e.relatedTarget) && dropTarget === dropId) {
          setDropTarget(null)
        }
      }}
      onDrop={e => { setDropTarget(null); onDropCommunity(e, c.id, c.name) }}
      className="rounded border px-1.5 py-1 transition-colors min-h-[40px]"
      style={{
        borderColor: isTarget && acmColor ? acmColor : isTarget ? '#14b8a6' : acmColor ? `${acmColor}44` : undefined,
        backgroundColor: isTarget && acmColor ? `${acmColor}28` : 'rgba(255,255,255,0.85)',
      }}
    >
      <div className="flex items-center gap-0.5">
        <MapPin className="w-2.5 h-2.5 flex-shrink-0" style={{ color: acmColor || '#087482' }} />
        <span className="text-[10px] font-medium text-gray-800 truncate leading-tight">{label}</span>
      </div>
      <div className="mt-0.5 truncate text-[9px] text-gray-500 leading-tight">
        {assigned.length === 0
          ? <span className="text-gray-300 italic">—</span>
          : assigned.map(b => shortName(b)).join(', ')}
      </div>
    </div>
  )
}

function UnassignedPanel({
  builders,
  canEdit,
  dropTarget,
  setDropTarget,
  allowDrop,
  onDrop,
  ...builderProps
}) {
  const dropId = 'unassigned'
  const isTarget = dropTarget === dropId

  if (!canEdit && builders.length === 0) return null

  return (
    <div className="w-40 sm:w-44 flex-shrink-0 flex flex-col min-h-0 glass-panel overflow-hidden">
      {/* Drop target bar — separate from draggable builder list */}
      {canEdit && (
        <div
          onDragOver={e => { allowDrop(e); setDropTarget(dropId) }}
          onDragLeave={e => {
            if (!e.currentTarget.contains(e.relatedTarget) && dropTarget === dropId) {
              setDropTarget(null)
            }
          }}
          onDrop={e => { setDropTarget(null); onDrop(e) }}
          className={cn(
            'flex-shrink-0 px-2 py-1 border-b text-center transition-colors',
            isTarget ? 'bg-gray-100 border-gray-300' : 'bg-gray-50/80 border-gray-100'
          )}
        >
          <p className="text-[8px] font-semibold uppercase tracking-wider text-gray-400">
            Drop to unassign ACM
          </p>
        </div>
      )}

      <div className="px-1.5 pt-1.5 pb-1 flex-shrink-0">
        <p className="text-[8px] font-semibold uppercase tracking-wider text-gray-400">
          Unassigned ({builders.length})
        </p>
      </div>

      {/* Builder list — no drop handlers so drag works reliably */}
      <div className="flex-1 min-h-0 overflow-y-auto px-1.5 pb-1.5 flex flex-col gap-0.5">
        {builders.length === 0 ? (
          <span className="text-[9px] text-gray-400 italic">None</span>
        ) : (
          builders.map(builder => (
            <BuilderTile key={builder.id} builder={builder} compact {...builderProps} />
          ))
        )}
      </div>
    </div>
  )
}

function BuilderTile({
  builder,
  canEdit,
  busy,
  draggingId,
  onDragStart,
  onDragEnd,
  onRemoveCommunity,
  onPromoteToFrontEnd,
  onDemoteFromFrontEnd,
  compact = false,
}) {
  const name = builder.full_name || builder.email
  const isFrontEnd = builder.is_front_end_builder
  const isDragging = draggingId === builder.id
  const commLabels = builder.assignments.map(a => a.community?.code || shortName({ full_name: a.community?.name }))

  return (
    <div
      draggable={canEdit && !busy}
      onDragStart={e => onDragStart(e, builder.id)}
      onDragEnd={onDragEnd}
      title={[name, commLabels.join(', '), isFrontEnd ? 'Front-end' : '', canEdit ? 'Drag to assign' : ''].filter(Boolean).join(' · ')}
      className={cn(
        'group flex items-center gap-1 rounded border bg-white transition-opacity select-none',
        compact ? 'px-1.5 py-1' : 'px-2 py-1',
        isFrontEnd ? 'border-violet-200 bg-violet-50/50' : 'border-gray-200',
        canEdit && !busy && 'cursor-grab active:cursor-grabbing hover:border-teal-400 hover:shadow-sm',
        isDragging && 'opacity-50 ring-2 ring-teal-400',
        busy && 'pointer-events-none opacity-60'
      )}
    >
      {canEdit && (
        <GripVertical className="w-3 h-3 text-gray-400 flex-shrink-0 pointer-events-none" />
      )}
      <div className="min-w-0 flex-1 pointer-events-none">
        <div className="flex items-center gap-0.5">
          <span className="text-[10px] font-medium text-gray-900 truncate leading-tight">
            {shortName(builder)}
          </span>
          {isFrontEnd && (
            <span className="text-[7px] font-bold text-violet-600 bg-violet-100 px-0.5 rounded flex-shrink-0">
              FE
            </span>
          )}
        </div>
        {commLabels.length > 0 && (
          <div className="truncate text-[8px] text-teal-700 leading-tight mt-px">
            {commLabels.join(' · ')}
          </div>
        )}
      </div>
      {canEdit && (
        <div className="flex flex-col gap-0.5 flex-shrink-0">
          {builder.assignments.map(a => (
            <button
              key={a.community_id}
              type="button"
              onMouseDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); onRemoveCommunity(builder, a.community_id, a.community?.name) }}
              className="text-[8px] text-gray-300 hover:text-red-500 leading-none px-0.5"
              title={`Remove from ${a.community?.name}`}
            >
              ×
            </button>
          ))}
          <button
            type="button"
            onMouseDown={e => e.stopPropagation()}
            onClick={e => {
              e.stopPropagation()
              isFrontEnd ? onDemoteFromFrontEnd(builder) : onPromoteToFrontEnd(builder)
            }}
            title={isFrontEnd ? 'Remove front-end' : 'Promote to front-end'}
            className={cn(
              'text-[7px] font-semibold px-0.5 rounded leading-tight',
              isFrontEnd ? 'text-violet-500 hover:bg-violet-100' : 'text-teal-600 hover:bg-teal-50'
            )}
          >
            {isFrontEnd ? '−FE' : '+FE'}
          </button>
        </div>
      )}
    </div>
  )
}

function shortName(person) {
  const name = person.full_name || person.email || ''
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return `${parts[0]} ${parts[parts.length - 1][0]}.`
  return name.split('@')[0]
}
