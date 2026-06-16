import { useState, useEffect, useRef, useMemo } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useMapData } from '../hooks/useMapData'
import { MapPin } from 'lucide-react'

const PALETTE = ['#087482', '#2196f3', '#f9a825', '#e91e63']

function buildColorMap(managers) {
  const map = {}
  managers.forEach((m, i) => { map[m.id] = PALETTE[i % PALETTE.length] })
  return map
}

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

  return L.divIcon({
    html: svg,
    className: '',
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    tooltipAnchor: [16, -4],
  })
}

export default function MapPage() {
  const { communities, vendors, categories, managers, assignments, loading } = useMapData()

  const [hiddenManagers, setHiddenManagers] = useState(new Set())
  const [selectedVendorId, setSelectedVendorId] = useState('')
  const [selectedCategoryId, setSelectedCategoryId] = useState('')
  const [mapReady, setMapReady] = useState(false)

  const mapContainerRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef([])

  // Initialize Leaflet map once
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

  // Covered community ids for the active filter
  const coveredIds = useMemo(() => {
    if (!selectedVendorId && !selectedCategoryId) return null

    const vendorIds = new Set()
    if (selectedVendorId) {
      vendorIds.add(selectedVendorId)
    } else {
      vendors.filter(v => v.category_id === selectedCategoryId).forEach(v => vendorIds.add(v.id))
    }

    const covered = new Set()
    assignments.forEach(a => {
      if (vendorIds.has(a.vendor_id)) covered.add(a.community_id)
    })
    return covered
  }, [selectedVendorId, selectedCategoryId, assignments, vendors])

  // Per-manager coverage stats
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

  // Rebuild markers whenever data or filters change
  useEffect(() => {
    if (!mapReady || loading) return

    markersRef.current.forEach(m => m.remove())
    markersRef.current = []

    const colorMap = buildColorMap(managers)
    const managerNames = Object.fromEntries(managers.map(m => [m.id, m.full_name]))
    const isFiltered = coveredIds !== null

    communities.forEach(c => {
      if (!c.lat || !c.lng) return
      if (c.area_manager_id && hiddenManagers.has(c.area_manager_id)) return

      const color = colorMap[c.area_manager_id] ?? '#9e9e9e'
      const isCovered = !isFiltered || coveredIds.has(c.id)
      const opacity = isFiltered && !isCovered ? 0.2 : 1

      const icon = makeIcon(c.brand, color, opacity)
      const marker = L.marker([c.lat, c.lng], { icon })

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

  const pinnedCount = communities.filter(c => c.lat && c.lng).length
  const unpinnedCount = communities.length - pinnedCount

  const colorMap = useMemo(() => buildColorMap(managers), [managers])

  function toggleManager(id) {
    setHiddenManagers(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectVendor(id) {
    setSelectedVendorId(id)
    setSelectedCategoryId('')
  }

  function selectCategory(id) {
    setSelectedCategoryId(id)
    setSelectedVendorId('')
  }

  return (
    // position:fixed escapes AppLayout's p-8 cleanly, sidebar is 16rem wide
    <div style={{
      position: 'fixed',
      top: 0,
      left: '16rem',
      right: 0,
      bottom: 0,
      display: 'flex',
      zIndex: 5,
    }}>
      {/* ── Left control panel ── */}
      <div style={{
        width: '256px',
        minWidth: '256px',
        background: '#fff',
        borderRight: '1px solid #e5e3db',
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
      }}>
        {/* Header */}
        <div style={{ padding: '16px', borderBottom: '1px solid #f0ede4' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <MapPin style={{ width: '18px', height: '18px', color: '#087482' }} />
            <span style={{ fontWeight: 600, fontSize: '14px', color: '#1a1a18' }}>Community Map</span>
          </div>
          <p style={{ fontSize: '11px', color: '#aaa', marginTop: '4px' }}>
            {loading ? 'Loading…' : `${pinnedCount} of ${communities.length} communities pinned`}
            {!loading && unpinnedCount > 0 ? ` · ${unpinnedCount} unmapped` : ''}
          </p>
        </div>

        {/* Area Managers */}
        <div style={{ padding: '12px 14px', borderBottom: '1px solid #f0ede4' }}>
          <p style={{ fontSize: '10px', fontWeight: 600, color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>
            Area Managers
          </p>
          {loading ? (
            <p style={{ fontSize: '12px', color: '#ccc' }}>Loading…</p>
          ) : managers.length === 0 ? (
            <p style={{ fontSize: '11px', color: '#aaa', fontStyle: 'italic', lineHeight: 1.4 }}>
              No managers found. Add users with "manager" role in Admin → User Management.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {managers.map((m, i) => {
                const color = PALETTE[i % PALETTE.length]
                const isHidden = hiddenManagers.has(m.id)
                const mineCount = communities.filter(c => c.area_manager_id === m.id && c.lat && c.lng).length
                return (
                  <button
                    key={m.id}
                    onClick={() => toggleManager(m.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      padding: '6px 10px', borderRadius: '6px',
                      border: `1px solid ${isHidden ? '#e0e0e0' : color + '55'}`,
                      background: isHidden ? '#f5f5f5' : color + '18',
                      opacity: isHidden ? 0.5 : 1,
                      cursor: 'pointer', textAlign: 'left',
                      fontSize: '12px', fontWeight: 500,
                      color: isHidden ? '#999' : '#333',
                      transition: 'opacity 0.15s',
                    }}
                  >
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
          <p style={{ fontSize: '10px', fontWeight: 600, color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>
            Filter Coverage
          </p>
          <select
            value={selectedVendorId}
            onChange={e => selectVendor(e.target.value)}
            style={{ width: '100%', padding: '7px 10px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '12px', background: '#fff', marginBottom: '6px', outline: 'none', color: selectedVendorId ? '#333' : '#999' }}
          >
            <option value="">All vendors</option>
            {vendors.map(v => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
          <select
            value={selectedCategoryId}
            onChange={e => selectCategory(e.target.value)}
            style={{ width: '100%', padding: '7px 10px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '12px', background: '#fff', outline: 'none', color: selectedCategoryId ? '#333' : '#999' }}
          >
            <option value="">— or filter by category —</option>
            {categories.map(cat => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>
          {(selectedVendorId || selectedCategoryId) && (
            <button
              onClick={() => { setSelectedVendorId(''); setSelectedCategoryId('') }}
              style={{ marginTop: '6px', fontSize: '11px', color: '#aaa', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              ✕ Clear filter
            </button>
          )}
        </div>

        {/* Coverage stats */}
        {stats && (
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
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0, background: PALETTE[i % PALETTE.length] }} />
                    <span style={{ color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.full_name}</span>
                  </div>
                  <span style={{ fontWeight: 600, marginLeft: '8px', flexShrink: 0, color: m.gap ? '#d97706' : '#444' }}>
                    {m.covered}/{m.total}
                  </span>
                </div>
              ))}
            </div>

            {stats.byManager.some(m => m.gap) && (
              <div style={{ marginTop: '10px', padding: '8px 10px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '6px' }}>
                <p style={{ fontSize: '11px', fontWeight: 600, color: '#92400e', marginBottom: '4px' }}>⚠ Coverage gap</p>
                {stats.byManager.filter(m => m.gap).map(m => (
                  <p key={m.id} style={{ fontSize: '11px', color: '#b45309', margin: 0 }}>{m.full_name}'s zone has no coverage.</p>
                ))}
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
          </div>
        </div>
      </div>

      {/* ── Map area ── */}
      <div style={{ flex: 1, position: 'relative' }}>
        {/* Loading overlay */}
        {loading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.85)', zIndex: 1000 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ width: '32px', height: '32px', border: '3px solid #e0f2f4', borderTopColor: '#087482', borderRadius: '50%', animation: 'spin 0.7s linear infinite', margin: '0 auto 10px' }} />
              <p style={{ fontSize: '13px', color: '#888' }}>Loading map data…</p>
            </div>
          </div>
        )}

        {/* No coordinates yet */}
        {!loading && pinnedCount === 0 && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, pointerEvents: 'none' }}>
            <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid #e5e3db', boxShadow: '0 4px 20px rgba(0,0,0,0.1)', padding: '28px', textAlign: 'center', maxWidth: '300px' }}>
              <MapPin style={{ width: '40px', height: '40px', color: '#ddd', margin: '0 auto 12px' }} />
              <p style={{ fontWeight: 600, fontSize: '14px', color: '#444', marginBottom: '6px' }}>No communities mapped yet</p>
              <p style={{ fontSize: '12px', color: '#aaa', lineHeight: 1.5 }}>
                Go to Admin → Community Map to add GPS coordinates for each community.
              </p>
            </div>
          </div>
        )}

        <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .leaflet-tooltip { border-radius: 8px !important; border: 1px solid #e5e3db !important; box-shadow: 0 4px 12px rgba(0,0,0,0.1) !important; padding: 8px 10px !important; }
        .leaflet-tooltip-top::before { border-top-color: #e5e3db !important; }
      `}</style>
    </div>
  )
}
