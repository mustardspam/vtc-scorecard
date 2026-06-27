import { useState, useCallback, useMemo, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useTeamData } from '../hooks/useTeamData'
import { logActivity } from '../hooks/useActivityLog'
import { buildAcmColorMap, acmPanelStyle } from '../lib/acm-colors'
import { Users, MapPin, AlertCircle, RefreshCw, X } from 'lucide-react'
import { cn } from '../lib/cn'

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
  const [selectedBuilderId, setSelectedBuilderId] = useState(null)

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
    }
  }, [])

  const allBuilders = useMemo(() => {
    const map = new Map()
    for (const g of teams.grouped) {
      for (const b of g.builders) map.set(b.id, b)
    }
    for (const b of teams.unassigned) map.set(b.id, b)
    return [...map.values()].sort((a, b) =>
      (a.full_name || a.email).localeCompare(b.full_name || b.email)
    )
  }, [teams])

  const selectedBuilder = allBuilders.find(b => b.id === selectedBuilderId) ?? null

  useEffect(() => {
    if (selectedBuilderId && !allBuilders.some(b => b.id === selectedBuilderId)) {
      setSelectedBuilderId(null)
    }
  }, [allBuilders, selectedBuilderId])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') setSelectedBuilderId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function toggleBuilder(builderId) {
    if (!canEdit || busy) return
    setSelectedBuilderId(prev => (prev === builderId ? null : builderId))
    setActionError('')
  }

  async function handlePlaceOnCommunity(communityId, communityName) {
    if (!canEdit || busy || !selectedBuilderId) return
    const builder = allBuilders.find(b => b.id === selectedBuilderId)
    if (!builder) return
    if (builder.assignments.some(a => a.community_id === communityId)) return
    await runAction(
      () => assignCommunity(selectedBuilderId, communityId),
      `Assigned ${builder.full_name || 'builder'} to ${communityName}`,
      { builder_id: selectedBuilderId, community_id: communityId }
    )
  }

  async function handlePlaceOnAcm(acmId, acmName) {
    if (!canEdit || busy || !selectedBuilderId) return
    const builder = allBuilders.find(b => b.id === selectedBuilderId)
    if (!builder || builder.acm_id === acmId) return
    await runAction(
      () => moveBuilderToAcm(selectedBuilderId, acmId),
      `Moved ${builder.full_name || 'builder'} to ACM ${acmName}`,
      { builder_id: selectedBuilderId, acm_id: acmId }
    )
  }

  async function handleClearAcm() {
    if (!canEdit || busy || !selectedBuilder) return
    if (!selectedBuilder.acm_id) return
    await runAction(
      () => clearBuilderAcm(selectedBuilder.id),
      `Removed ${selectedBuilder.full_name || 'builder'} from ACM assignment`,
      { builder_id: selectedBuilder.id }
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

  const totalBuilders = allBuilders.length
  const acmColorMap = useMemo(() => buildAcmColorMap(teams.grouped), [teams.grouped])

  return (
    <div className="flex flex-col h-full min-h-0 gap-2">
      <div className="flex items-center justify-between gap-3 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Users className="w-5 h-5 text-teal-600 flex-shrink-0" />
          <h1 className="text-lg font-bold text-gray-900 truncate">Teams</h1>
          {canEdit && (
            <span className="hidden sm:inline text-[10px] text-gray-400 truncate">
              Select a builder → click a community code to assign
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

      {canEdit && selectedBuilder && (
        <div className="flex items-center gap-2 px-2 py-1.5 bg-teal-50 border border-teal-200 rounded-lg text-[11px] text-teal-900 flex-shrink-0">
          <span className="font-medium truncate">
            Selected: {selectedBuilder.full_name || selectedBuilder.email}
          </span>
          <span className="text-teal-600 hidden sm:inline">— click a community box to place</span>
          {selectedBuilder.acm_id && (
            <button
              type="button"
              onClick={handleClearAcm}
              disabled={busy}
              className="ml-auto text-[10px] text-gray-500 hover:text-red-600 underline flex-shrink-0"
            >
              Clear ACM
            </button>
          )}
          <button
            type="button"
            onClick={() => setSelectedBuilderId(null)}
            className="p-0.5 text-teal-600 hover:text-teal-800 flex-shrink-0"
            title="Clear selection (Esc)"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

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
                canEdit={canEdit}
                busy={busy}
                hasSelection={!!selectedBuilderId}
                onPlaceOnAcm={handlePlaceOnAcm}
                onPlaceOnCommunity={handlePlaceOnCommunity}
              />
            ))}
          </div>

          <BuilderPanel
            builders={allBuilders}
            selectedBuilderId={selectedBuilderId}
            canEdit={canEdit}
            busy={busy}
            onSelect={toggleBuilder}
            onRemoveCommunity={handleRemoveCommunity}
            onPromoteToFrontEnd={handlePromoteToFrontEnd}
            onDemoteFromFrontEnd={handleDemoteFromFrontEnd}
          />
        </div>
      )}
    </div>
  )
}

function AcmRow({
  acm,
  acmColor,
  canEdit,
  busy,
  hasSelection,
  onPlaceOnAcm,
  onPlaceOnCommunity,
}) {
  const panelStyle = acmPanelStyle(acmColor)

  return (
    <div
      className="glass-panel overflow-hidden min-h-[64px]"
      style={{ borderColor: panelStyle.borderColor }}
    >
      <div
        className="p-2"
        style={panelStyle}
      >
        <button
          type="button"
          disabled={!canEdit || !hasSelection || busy}
          onClick={() => onPlaceOnAcm(acm.id, acm.full_name || acm.email)}
          className={cn(
            'flex items-center gap-1.5 mb-1.5 w-full text-left rounded px-0.5 -mx-0.5 transition-colors',
            canEdit && hasSelection && !busy && 'hover:bg-white/40 cursor-pointer',
            !hasSelection && 'cursor-default'
          )}
          title={canEdit && hasSelection ? 'Assign selected builder to this ACM (no community yet)' : undefined}
        >
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
        </button>

        {acm.communities.length === 0 ? (
          <p className="text-[10px] text-amber-600 italic">
            {canEdit && hasSelection
              ? 'Click ACM name above to assign, or add communities in Community Map'
              : 'No communities — assign in Community Map'}
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-1">
            {acm.communities.map(c => (
              <CommunitySlot
                key={c.id}
                community={c}
                builders={acm.builders}
                acmColor={acmColor}
                canEdit={canEdit}
                busy={busy}
                hasSelection={hasSelection}
                onPlace={() => onPlaceOnCommunity(c.id, c.name)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function CommunitySlot({
  community: c,
  builders,
  acmColor,
  canEdit,
  busy,
  hasSelection,
  onPlace,
}) {
  const assigned = builders.filter(b => b.assignments.some(a => a.community_id === c.id))
  const label = c.code || c.name
  const clickable = canEdit && hasSelection && !busy

  return (
    <button
      type="button"
      title={clickable ? `Place selected builder in ${c.name}` : c.name}
      disabled={!clickable}
      onClick={onPlace}
      className={cn(
        'rounded border px-1.5 py-1 text-left transition-all min-h-[40px]',
        clickable && 'cursor-pointer hover:scale-[1.02] hover:shadow-sm active:scale-[0.98]',
        !clickable && 'cursor-default'
      )}
      style={{
        borderColor: clickable && acmColor ? acmColor : acmColor ? `${acmColor}44` : undefined,
        backgroundColor: clickable && acmColor ? `${acmColor}30` : 'rgba(255,255,255,0.85)',
        boxShadow: clickable && acmColor ? `0 0 0 1px ${acmColor}55` : undefined,
      }}
    >
      <div className="flex items-center gap-0.5">
        <MapPin className="w-2.5 h-2.5 flex-shrink-0" style={{ color: acmColor || '#087482' }} />
        <span className="text-[10px] font-semibold text-gray-800 truncate leading-tight">{label}</span>
      </div>
      <div className="mt-0.5 truncate text-[9px] text-gray-500 leading-tight">
        {assigned.length === 0
          ? <span className="text-gray-300 italic">{clickable ? 'click to place' : '—'}</span>
          : assigned.map(b => shortName(b)).join(', ')}
      </div>
    </button>
  )
}

function BuilderPanel({
  builders,
  selectedBuilderId,
  canEdit,
  busy,
  onSelect,
  onRemoveCommunity,
  onPromoteToFrontEnd,
  onDemoteFromFrontEnd,
}) {
  if (!canEdit && builders.length === 0) return null

  return (
    <div className="w-44 sm:w-52 flex-shrink-0 flex flex-col min-h-0 glass-panel overflow-hidden">
      <div className="px-2 py-1.5 border-b border-gray-100 flex-shrink-0 bg-gray-50/80">
        <p className="text-[8px] font-semibold uppercase tracking-wider text-gray-500">
          Builders ({builders.length})
        </p>
        {canEdit && (
          <p className="text-[9px] text-gray-400 mt-0.5 leading-tight">
            Click to select, then click a community
          </p>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-1.5 py-1.5 flex flex-col gap-0.5">
        {builders.length === 0 ? (
          <span className="text-[9px] text-gray-400 italic">None</span>
        ) : (
          builders.map(builder => (
            <BuilderTile
              key={builder.id}
              builder={builder}
              selected={selectedBuilderId === builder.id}
              canEdit={canEdit}
              busy={busy}
              onSelect={onSelect}
              onRemoveCommunity={onRemoveCommunity}
              onPromoteToFrontEnd={onPromoteToFrontEnd}
              onDemoteFromFrontEnd={onDemoteFromFrontEnd}
            />
          ))
        )}
      </div>
    </div>
  )
}

function BuilderTile({
  builder,
  selected,
  canEdit,
  busy,
  onSelect,
  onRemoveCommunity,
  onPromoteToFrontEnd,
  onDemoteFromFrontEnd,
}) {
  const name = builder.full_name || builder.email
  const isFrontEnd = builder.is_front_end_builder
  const commLabels = builder.assignments.map(a => a.community?.code || shortName({ full_name: a.community?.name }))

  return (
    <div
      role={canEdit ? 'button' : undefined}
      tabIndex={canEdit && !busy ? 0 : undefined}
      onClick={() => onSelect(builder.id)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(builder.id) } }}
      title={[name, commLabels.join(', '), isFrontEnd ? 'Front-end' : '', canEdit ? 'Click to select' : ''].filter(Boolean).join(' · ')}
      className={cn(
        'flex items-center gap-1 rounded border px-1.5 py-1 transition-all select-none',
        isFrontEnd && !selected && 'border-violet-200 bg-violet-50/50',
        !isFrontEnd && !selected && 'border-gray-200 bg-white',
        selected && 'border-teal-500 bg-teal-50 ring-2 ring-teal-400 shadow-sm',
        canEdit && !busy && 'cursor-pointer hover:border-teal-400',
        busy && 'opacity-60 pointer-events-none'
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-0.5">
          <span className={cn('text-[10px] truncate leading-tight', selected ? 'font-semibold text-teal-900' : 'font-medium text-gray-900')}>
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
        <div className="flex flex-col gap-0.5 flex-shrink-0" onClick={e => e.stopPropagation()}>
          {builder.assignments.map(a => (
            <button
              key={a.community_id}
              type="button"
              onClick={() => onRemoveCommunity(builder, a.community_id, a.community?.name)}
              className="text-[8px] text-gray-300 hover:text-red-500 leading-none px-0.5"
              title={`Remove from ${a.community?.name}`}
            >
              ×
            </button>
          ))}
          <button
            type="button"
            onClick={() => (isFrontEnd ? onDemoteFromFrontEnd(builder) : onPromoteToFrontEnd(builder))}
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
