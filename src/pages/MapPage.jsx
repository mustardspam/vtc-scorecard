import { useState, useEffect, useRef, useMemo } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useMapData } from '../hooks/useMapData'
import { ACM_PALETTE, buildAcmColorMap } from '../lib/acm-colors'
import { MapPin } from 'lucide-react'

function makeIcon(brand, color, opacity) {
  const isSL = brand?.toLowerCase().includes('starlight')
  const label = isSL ? 'SL' : 'AW'
  const shape = isSL
    ? `<polygon points="16,3 18.94,11.95 28.36,11.98 20.76,17.55 23.64,26.52 16,21 8.36,26.52 11.24,17.55 3.64,11.98 13.06,11.95" fill="${color}" stroke="white" stroke-width="2.5"/>`
    : `<circle cx="16" cy="16" r="13" fill="${color}" stroke="white" stroke-width="2.5"/>`
  const textY = isSL ? '19' : '20'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    <g opacity="${opacity}">
      ${shape}
      <text x="16" y="${textY}" text-anchor="middle" fill="white" font-size="9" font-weight="700" font-family="system-ui,sans-serif">${label}</text>
    </g>
  </svg>`
  return L.divIcon({ html: svg, className: '', iconSize: [32, 32], iconAnchor: [16, 16], tooltipAnchor: [16, -4] })
}

function distinctPinnedCommunities(assignments, vendorId, pinnedIds) {
  const ids = new Set()
  for (const a of assignments) {
    if (a.vendor_id === vendorId && pinnedIds.has(a.community_id)) ids.add(a.community_id)
  }
  return ids.size
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Sanity bounding box for the greater Houston service area. A coordinate outside
// this box is almost certainly bad data — a flipped longitude sign, a swapped
// lat/lng pair, or a typo — and would silently blow up the spread stats, so we
// flag it instead of trusting it. Generous enough to cover every outlying suburb.
const SANE_BOX = { latMin: 28.0, latMax: 31.5, lngMin: -97.5, lngMax: -93.5 }
function isSaneCoord(lat, lng) {
  const a = +lat, n = +lng
  return Number.isFinite(a) && Number.isFinite(n) &&
    a >= SANE_BOX.latMin && a <= SANE_BOX.latMax &&
    n >= SANE_BOX.lngMin && n <= SANE_BOX.lngMax
}

export default function MapPage() {
  const { communities, vendors, categories, managers, assignments, loading, assignmentsLoading, error } = useMapData()

  const [hiddenManagers, setHiddenManagers] = useState(new Set())
  const [selectedVendorId, setSelectedVendorId] = useState('')
  const [selectedCategoryId, setSelectedCategoryId] = useState('')
  const [mapReady, setMapReady] = useState(false)

  const mapContainerRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef([])
  const linesRef = useRef([])

  useEffect(() => {
    if (mapRef.current || !mapContainerRef.current) return
    mapRef.current = L.map(mapContainerRef.current, {
      center: [29.7604, -95.3698],
      zoom: 10,
      zoomControl: false,
    })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(mapRef.current)
    L.control.zoom({ position: 'topright' }).addTo(mapRef.current)
    setMapReady(true)
    return () => {
      mapRef.current?.remove()
      mapRef.current = null
      setMapReady(false)
    }
  }, [])

  const coveredIds = useMemo(() => {
    if (!selectedVendorId && !selectedCategoryId) return null
    const vendorIds = new Set()
    if (selectedVendorId) {
      vendorIds.add(selectedVendorId)
    } else {
      vendors.filter(v => v.category_id === selectedCategoryId).forEach(v => vendorIds.add(v.id))
    }
    const covered = new Set()
    assignments.forEach(a => { if (vendorIds.has(a.vendor_id)) covered.add(a.community_id) })
    return covered
  }, [selectedVendorId, selectedCategoryId, assignments, vendors])

  const stats = useMemo(() => {
    if (!coveredIds) return null
    const pinned = communities.filter(c => c.lat && c.lng)
    const covered = pinned.filter(c => coveredIds.has(c.id)).length
    const byManager = managers.map(m => {
      const mine = pinned.filter(c => c.area_manager_id === m.id)
      const cnt = mine.filter(c => coveredIds.has(c.id)).length
      return { ...m, total: mine.length, covered: cnt, gap: cnt === 0 && mine.length > 0 }
    })
    return { total: pinned.length, covered, byManager }
  }, [coveredIds, communities, managers])

  // Vendor distribution — only computed when filtering by category
  const categoryVendorStats = useMemo(() => {
    if (!selectedCategoryId) return null
    const catVendors = vendors.filter(v => v.category_id === selectedCategoryId)
    const pinnedIds = new Set(communities.filter(c => c.lat && c.lng).map(c => c.id))
    const rows = catVendors.map(v => {
      const communityCount = distinctPinnedCommunities(assignments, v.id, pinnedIds)
      return { id: v.id, name: v.name, communityCount }
    }).sort((a, b) => b.communityCount - a.communityCount)
    const max = rows[0]?.communityCount || 1
    const totalCovered = new Set(
      assignments.filter(a => catVendors.some(v => v.id === a.vendor_id) && pinnedIds.has(a.community_id)).map(a => a.community_id)
    ).size
    return { rows, max, totalCovered, vendorCount: catVendors.length }
  }, [selectedCategoryId, vendors, assignments, communities])

  // Spread stats — only computed when filtering by a specific vendor
  const spreadStats = useMemo(() => {
    if (!selectedVendorId || !coveredIds) return null
    const mapped = communities.filter(c => c.lat && c.lng && coveredIds.has(c.id))
    // Drop bad coordinates so one corrupt row can't blow up the spread stats.
    const covered = mapped.filter(c => isSaneCoord(c.lat, c.lng))
    if (covered.length < 2) return { covered, maxMi: 0, avgMi: 0, level: 'Low', levelColor: '#087482', farthestA: null, farthestB: null }

    let maxDist = 0, farthestA = null, farthestB = null
    for (let i = 0; i < covered.length; i++) {
      for (let j = i + 1; j < covered.length; j++) {
        const d = haversineKm(+covered[i].lat, +covered[i].lng, +covered[j].lat, +covered[j].lng)
        if (d > maxDist) { maxDist = d; farthestA = covered[i]; farthestB = covered[j] }
      }
    }

    const centLat = covered.reduce((s, c) => s + +c.lat, 0) / covered.length
    const centLng = covered.reduce((s, c) => s + +c.lng, 0) / covered.length
    const avgDist = covered.reduce((s, c) => s + haversineKm(centLat, centLng, +c.lat, +c.lng), 0) / covered.length

    const maxMi = maxDist * 0.621371
    const avgMi = avgDist * 0.621371
    const level = maxMi < 15 ? 'Low' : maxMi < 30 ? 'Medium' : 'High'
    const levelColor = maxMi < 15 ? '#087482' : maxMi < 30 ? '#d97706' : '#c0392b'

    return { covered, maxMi, avgMi, level, levelColor, farthestA, farthestB }
  }, [selectedVendorId, coveredIds, communities])

  // Rebuild markers
  useEffect(() => {
    if (!mapReady || loading) return
    markersRef.current.forEach(m => m.remove())
    markersRef.current = []
    const colorMap = buildAcmColorMap(managers)
    const managerNames = Object.fromEntries(managers.map(m => [m.id, m.full_name]))
    const isFiltered = coveredIds !== null
    communities.forEach(c => {
      if (!c.lat || !c.lng) return
      if (!isSaneCoord(c.lat, c.lng)) return // bad data — surfaced via the header warning instead
      if (c.area_manager_id && hiddenManagers.has(c.area_manager_id)) return
      const color = colorMap[c.area_manager_id] ?? '#9e9e9e'
      const isCovered = !isFiltered || coveredIds.has(c.id)
      const opacity = isFiltered && !isCovered ? 0.2 : 1
      const icon = makeIcon(c.brand, color, opacity)
      const marker = L.marker([+c.lat, +c.lng], { icon })
      const managerName = c.area_manager_id ? (managerNames[c.area_manager_id] ?? 'Unknown') : 'Unassigned'
      const brandLabel = c.brand?.toLowerCase().includes('starlight') ? 'SL' : 'AW'
      const brandBg = brandLabel === 'SL' ? '#d81b60' : '#1565c0'
      const coverageHtml = isFiltered
        ? `<div style="font-size:11px;font-weight:600;margin-top:5px;color:${isCovered ? '#087482' : '#bbb'};">${isCovered ? '✓ Covered' : '✗ Not covered'}</div>`
        : ''
      marker.bindTooltip(
        `<div style="font-family:system-ui,sans-serif;padding:2px 0;min-width:155px;">
          <div style="font-weight:700;font-size:13px;margin-bottom:4px;color:#1a1a18;">${c.name}</div>
          <div style="margin-bottom:3px;">
            <span style="background:${brandBg};color:#fff;font-size:9px;font-weight:700;border-radius:3px;padding:1px 5px;">${brandLabel}</span>
            <span style="color:#888;font-size:11px;margin-left:5px;">${c.code}</span>
          </div>
          <div style="font-size:11px;color:#555;">Manager: <strong style="color:#333;">${managerName}</strong></div>
          ${coverageHtml}
        </div>`,
        { sticky: true }
      )
      marker.addTo(mapRef.current)
      markersRef.current.push(marker)
    })
  }, [mapReady, loading, communities, managers, hiddenManagers, coveredIds])

  // Draw/remove spread lines when vendor filter or spread stats change
  useEffect(() => {
    if (!mapReady) return
    linesRef.current.forEach(l => l.remove())
    linesRef.current = []
    if (!spreadStats || spreadStats.covered.length < 2) return

    const { covered, farthestA, farthestB } = spreadStats

    // All-pairs gray dashed connections
    for (let i = 0; i < covered.length; i++) {
      for (let j = i + 1; j < covered.length; j++) {
        const a = covered[i], b = covered[j]
        const isFarthest = (a.id === farthestA?.id && b.id === farthestB?.id) ||
                           (a.id === farthestB?.id && b.id === farthestA?.id)
        if (!isFarthest) {
          const line = L.polyline(
            [[+a.lat, +a.lng], [+b.lat, +b.lng]],
            { color: '#888888', weight: 1.2, opacity: 0.5, dashArray: '6 4' }
          ).addTo(mapRef.current)
          linesRef.current.push(line)
        }
      }
    }

    // Farthest pair in red on top
    if (farthestA && farthestB) {
      const line = L.polyline(
        [[+farthestA.lat, +farthestA.lng], [+farthestB.lat, +farthestB.lng]],
        { color: '#c0392b', weight: 2, opacity: 0.8, dashArray: '6 4' }
      ).addTo(mapRef.current)
      linesRef.current.push(line)
    }
  }, [mapReady, spreadStats])

  const pinnedCount = communities.filter(c => c.lat && c.lng).length
  const unpinnedCount = communities.length - pinnedCount
  // Pinned communities whose coordinates fall outside the Houston service area —
  // bad data that would otherwise distort spread stats and place pins off-map.
  const badCoordCommunities = useMemo(
    () => communities.filter(c => c.lat && c.lng && !isSaneCoord(c.lat, c.lng)),
    [communities]
  )
  const colorMap = useMemo(() => buildAcmColorMap(managers), [managers])

  function toggleManager(id) {
    setHiddenManagers(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectVendor(id) { setSelectedVendorId(id); setSelectedCategoryId('') }
  function selectCategory(id) { setSelectedCategoryId(id); setSelectedVendorId('') }

  const selectedVendorName = vendors.find(v => v.id === selectedVendorId)?.name ?? ''

  return (
    <div className="flex h-full min-h-0 min-w-0 z-[5]">
      {/* ── Left control panel ── */}
      <div style={{ width: '256px', minWidth: '256px', background: 'var(--g-panel)', borderRight: '1px solid var(--g-line)', display: 'flex', flexDirection: 'column', overflowY: 'auto', backdropFilter: 'saturate(160%) blur(18px)' }}>
        {/* Header */}
        <div style={{ padding: '16px', borderBottom: '1px solid #f0ede4' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <MapPin style={{ width: '18px', height: '18px', color: '#087482' }} />
            <span style={{ fontWeight: 600, fontSize: '14px', color: '#1a1a18' }}>Community Map</span>
          </div>
          <p style={{ fontSize: '11px', color: '#aaa', marginTop: '4px' }}>
            {loading ? 'Loading…' : `${pinnedCount} of ${communities.length} communities pinned`}
            {!loading && unpinnedCount > 0 ? ` · ${unpinnedCount} unmapped` : ''}
            {!loading && assignmentsLoading ? ' · loading coverage…' : ''}
          </p>
          {!loading && badCoordCommunities.length > 0 && (
            <p style={{ fontSize: '11px', color: '#c0392b', marginTop: '6px', fontWeight: 600, lineHeight: 1.4 }}>
              ⚠ {badCoordCommunities.length} {badCoordCommunities.length === 1 ? 'community has' : 'communities have'} invalid coordinates and {badCoordCommunities.length === 1 ? 'is' : 'are'} excluded from the map: {badCoordCommunities.map(c => c.code || c.name).join(', ')}. Fix in Admin → Community Map.
            </p>
          )}
          {error && (
            <p style={{ fontSize: '11px', color: '#c0392b', marginTop: '4px' }}>{error}</p>
          )}
        </div>

        {/* Area Managers */}
        <div style={{ padding: '12px 14px', borderBottom: '1px solid #f0ede4' }}>
          <p style={{ fontSize: '10px', fontWeight: 600, color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>Area Managers</p>
          {loading ? (
            <p style={{ fontSize: '12px', color: '#ccc' }}>Loading…</p>
          ) : managers.length === 0 ? (
            <p style={{ fontSize: '11px', color: '#aaa', fontStyle: 'italic', lineHeight: 1.4 }}>No managers found. Add users with "manager" role in Admin → User Management.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {managers.map((m, i) => {
                const color = ACM_PALETTE[i % ACM_PALETTE.length]
                const isHidden = hiddenManagers.has(m.id)
                const mineCount = communities.filter(c => c.area_manager_id === m.id && c.lat && c.lng).length
                return (
                  <button key={m.id} onClick={() => toggleManager(m.id)} style={{
                    display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', borderRadius: '6px',
                    border: `1px solid ${isHidden ? '#e0e0e0' : color + '55'}`,
                    background: isHidden ? '#f5f5f5' : color + '18',
                    opacity: isHidden ? 0.5 : 1, cursor: 'pointer', textAlign: 'left',
                    fontSize: '12px', fontWeight: 500, color: isHidden ? '#999' : '#333', transition: 'opacity 0.15s',
                  }}>
                    <span style={{ width: '10px', height: '10px', borderRadius: '50%', flexShrink: 0, background: isHidden ? '#ccc' : color }} />
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.full_name}</span>
                    <span style={{ color: '#aaa', fontWeight: 400, flexShrink: 0 }}>{mineCount}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Vendor / Category filter */}
        <div style={{ padding: '12px 14px', borderBottom: '1px solid #f0ede4' }}>
          <p style={{ fontSize: '10px', fontWeight: 600, color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>Filter Coverage</p>
          <select value={selectedVendorId} onChange={e => selectVendor(e.target.value)}
            style={{ width: '100%', padding: '7px 10px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '12px', background: '#fff', marginBottom: '6px', outline: 'none', color: selectedVendorId ? '#333' : '#999' }}>
            <option value="">All vendors</option>
            {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <select value={selectedCategoryId} onChange={e => selectCategory(e.target.value)}
            style={{ width: '100%', padding: '7px 10px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '12px', background: '#fff', outline: 'none', color: selectedCategoryId ? '#333' : '#999' }}>
            <option value="">— or filter by category —</option>
            {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
          </select>
          {(selectedVendorId || selectedCategoryId) && assignmentsLoading && (
            <p style={{ fontSize: '11px', color: '#aaa', marginTop: '6px' }}>Loading vendor coverage…</p>
          )}
          {(selectedVendorId || selectedCategoryId) && (
            <button onClick={() => { setSelectedVendorId(''); setSelectedCategoryId('') }}
              style={{ marginTop: '6px', fontSize: '11px', color: '#aaa', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              ✕ Clear filter
            </button>
          )}
        </div>

        {/* Coverage stats — vendor filter only */}
        {stats && selectedVendorId && (
          <div style={{ padding: '12px 14px', borderBottom: '1px solid #f0ede4' }}>
            <p style={{ fontSize: '10px', fontWeight: 600, color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>Coverage</p>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginBottom: '10px' }}>
              <span style={{ fontSize: '26px', fontWeight: 700, color: '#087482', lineHeight: 1 }}>{stats.covered}</span>
              <span style={{ fontSize: '12px', color: '#aaa' }}>/ {stats.total} communities</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              {stats.byManager.map((m, i) => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0, background: ACM_PALETTE[i % ACM_PALETTE.length] }} />
                    <span style={{ color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.full_name}</span>
                  </div>
                  <span style={{ fontWeight: 600, marginLeft: '8px', flexShrink: 0, color: '#444' }}>
                    {m.covered}/{m.total} communities
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Category vendor distribution */}
        {categoryVendorStats && (
          <div style={{ padding: '12px 14px', borderBottom: '1px solid #f0ede4' }}>
            <p style={{ fontSize: '10px', fontWeight: 600, color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>
              {categories.find(c => c.id === selectedCategoryId)?.name ?? 'Category'} Vendors
            </p>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginBottom: '2px' }}>
              <span style={{ fontSize: '26px', fontWeight: 700, color: '#087482', lineHeight: 1 }}>{categoryVendorStats.vendorCount}</span>
              <span style={{ fontSize: '12px', color: '#aaa' }}>vendors · {categoryVendorStats.totalCovered} communities</span>
            </div>
            <p style={{ fontSize: '11px', color: '#bbb', marginBottom: '10px' }}>tap a vendor to see spread</p>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {categoryVendorStats.rows.map(v => {
                const isLight = v.communityCount <= 1
                const barColor = isLight ? '#d97706' : '#087482'
                const barPct = Math.max(6, Math.round((v.communityCount / categoryVendorStats.max) * 100))
                const communityLabel = v.communityCount === 1 ? '1 community' : `${v.communityCount} communities`
                return (
                  <button
                    key={v.id}
                    onClick={() => selectVendor(v.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      padding: '6px 0', borderBottom: '1px solid #f5f5f5',
                      background: 'none', border: 'none', borderBottom: '1px solid #f5f5f5',
                      cursor: 'pointer', textAlign: 'left', width: '100%',
                    }}
                  >
                    <span style={{ fontSize: '12px', color: '#444', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                      {v.name}
                    </span>
                    <div style={{ width: '52px', flexShrink: 0, height: '4px', background: '#eee', borderRadius: '2px' }}>
                      <div style={{ width: `${barPct}%`, height: '4px', borderRadius: '2px', background: barColor }} />
                    </div>
                    <span style={{ fontSize: '11px', fontWeight: 600, minWidth: '88px', textAlign: 'right', flexShrink: 0, color: isLight ? '#d97706' : '#555' }}>
                      {communityLabel}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Vendor spread card — only shown when filtering by a specific vendor */}
        {spreadStats && (
          <div style={{ padding: '12px 14px', borderBottom: '1px solid #f0ede4' }}>
            <p style={{ fontSize: '10px', fontWeight: 600, color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>Vendor Spread</p>

            {spreadStats.covered.length < 2 ? (
              <p style={{ fontSize: '11px', color: '#aaa', fontStyle: 'italic' }}>
                {spreadStats.covered.length === 0 ? 'No mapped communities covered.' : 'Only 1 community — no spread to measure.'}
              </p>
            ) : (
              <div style={{ background: '#f8f7f4', borderRadius: '8px', padding: '10px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '2px' }}>
                  <span style={{ fontSize: '28px', fontWeight: 700, color: spreadStats.levelColor, lineHeight: 1 }}>
                    {Math.round(spreadStats.maxMi)} mi
                  </span>
                  <span style={{
                    fontSize: '10px', fontWeight: 600, padding: '2px 8px', borderRadius: '20px', marginTop: '4px',
                    background: spreadStats.levelColor + '1a', color: spreadStats.levelColor,
                  }}>{spreadStats.level}</span>
                </div>
                <p style={{ fontSize: '10px', color: '#aaa', marginBottom: '8px' }}>farthest communities apart</p>

                <div style={{ borderTop: '1px solid #e8e5de', paddingTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ fontSize: '11px', color: '#888' }}>
                    Avg from center: <span style={{ color: '#555', fontWeight: 500 }}>{Math.round(spreadStats.avgMi)} mi</span>
                  </div>
                  {spreadStats.farthestA && spreadStats.farthestB && (
                    <div style={{ fontSize: '11px', color: '#888' }}>
                      Farthest: <span style={{ color: '#c0392b', fontWeight: 500 }}>{spreadStats.farthestA.name} ↔ {spreadStats.farthestB.name}</span>
                    </div>
                  )}
                  <div style={{ fontSize: '11px', color: '#888', marginTop: '2px' }}>
                    Communities: <span style={{ color: '#555' }}>{spreadStats.covered.map(c => c.code || c.name).join(' · ')}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Legend */}
        <div style={{ padding: '12px 14px', marginTop: 'auto', borderTop: '1px solid #f0ede4' }}>
          <p style={{ fontSize: '10px', fontWeight: 600, color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>Legend</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '11px', color: '#666' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <svg width="18" height="18" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
                <circle cx="16" cy="16" r="13" fill="#087482" stroke="white" strokeWidth="2.5"/>
                <text x="16" y="20" textAnchor="middle" fill="white" fontSize="9" fontWeight="700" fontFamily="system-ui">AW</text>
              </svg>
              Ashton Woods community
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <svg width="18" height="18" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
                <polygon points="16,3 18.94,11.95 28.36,11.98 20.76,17.55 23.64,26.52 16,21 8.36,26.52 11.24,17.55 3.64,11.98 13.06,11.95" fill="#087482" stroke="white" strokeWidth="2.5"/>
                <text x="16" y="19" textAnchor="middle" fill="white" fontSize="8" fontWeight="700" fontFamily="system-ui">SL</text>
              </svg>
              Starlight community
            </div>
            {coveredIds !== null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <svg width="18" height="18" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="16" cy="16" r="13" fill="#ccc" stroke="white" strokeWidth="2.5" opacity="0.3"/>
                </svg>
                Not covered by filter
              </div>
            )}
            {spreadStats && spreadStats.covered.length >= 2 && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <svg width="18" height="4" xmlns="http://www.w3.org/2000/svg">
                    <line x1="0" y1="2" x2="18" y2="2" stroke="#888" strokeWidth="1.5" strokeDasharray="4 3"/>
                  </svg>
                  Vendor connections
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <svg width="18" height="4" xmlns="http://www.w3.org/2000/svg">
                    <line x1="0" y1="2" x2="18" y2="2" stroke="#c0392b" strokeWidth="2" strokeDasharray="4 3"/>
                  </svg>
                  Max spread
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Map area ── */}
      <div style={{ flex: 1, position: 'relative' }}>
        {loading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.85)', zIndex: 1000 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ width: '32px', height: '32px', border: '3px solid #e0f2f4', borderTopColor: '#087482', borderRadius: '50%', animation: 'spin 0.7s linear infinite', margin: '0 auto 10px' }} />
              <p style={{ fontSize: '13px', color: '#888' }}>Loading map data…</p>
            </div>
          </div>
        )}

        {!loading && pinnedCount === 0 && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, pointerEvents: 'none' }}>
            <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid #e5e3db', padding: '28px', textAlign: 'center', maxWidth: '300px' }}>
              <MapPin style={{ width: '40px', height: '40px', color: '#ddd', margin: '0 auto 12px' }} />
              <p style={{ fontWeight: 600, fontSize: '14px', color: '#444', marginBottom: '6px' }}>No communities mapped yet</p>
              <p style={{ fontSize: '12px', color: '#aaa', lineHeight: 1.5 }}>Go to Admin → Community Map to add GPS coordinates for each community.</p>
            </div>
          </div>
        )}

        {/* Map info banner */}
        {(spreadStats?.covered.length >= 2 || categoryVendorStats) && (
          <div style={{
            position: 'absolute', top: '12px', right: '54px', zIndex: 1000,
            background: 'rgba(255,255,255,0.95)', borderRadius: '8px', border: '1px solid #e5e3db',
            padding: '8px 12px', maxWidth: '260px',
            borderLeft: `4px solid ${spreadStats ? spreadStats.levelColor : '#087482'}`,
          }}>
            {spreadStats && spreadStats.covered.length >= 2 ? (
              <>
                <p style={{ fontSize: '11px', fontWeight: 600, color: spreadStats.levelColor, marginBottom: '2px' }}>
                  {selectedVendorName}
                </p>
                <p style={{ fontSize: '11px', color: '#555', margin: 0 }}>
                  {Math.round(spreadStats.maxMi)} mi spread across {spreadStats.covered.length} communities
                </p>
              </>
            ) : categoryVendorStats ? (
              <>
                <p style={{ fontSize: '11px', fontWeight: 600, color: '#087482', marginBottom: '2px' }}>
                  {categories.find(c => c.id === selectedCategoryId)?.name}
                </p>
                <p style={{ fontSize: '11px', color: '#555', margin: 0 }}>
                  {categoryVendorStats.vendorCount} vendors · {categoryVendorStats.totalCovered} communities covered
                </p>
              </>
            ) : null}
          </div>
        )}

        <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .leaflet-tile-pane { filter: grayscale(1) brightness(1.05); }
        .leaflet-tooltip { border-radius: 8px !important; border: 1px solid #e5e3db !important; box-shadow: 0 4px 12px rgba(0,0,0,0.1) !important; padding: 8px 10px !important; }
        .leaflet-tooltip-top::before { border-top-color: #e5e3db !important; }
      `}</style>
    </div>
  )
}
