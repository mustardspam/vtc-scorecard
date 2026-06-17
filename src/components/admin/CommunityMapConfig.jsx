import { useState, useEffect, memo, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { MapPin, CheckCircle, AlertCircle } from 'lucide-react'

export default function CommunityMapConfig() {
  const [communities, setCommunities] = useState([])
  const [managers, setManagers] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const [commRes, manRes] = await Promise.all([
        supabase.from('communities').select('*').order('name'),
        supabase.from('profiles').select('id, full_name').eq('is_area_manager', true).order('full_name'),
      ])
      setCommunities(commRes.data || [])
      setManagers(manRes.data || [])
      setLoading(false)
    }
    load()
  }, [])

  const handleUpdate = useCallback(async (id, field, value) => {
    const dbValue = (value === '' || value === null) ? null : value
    setCommunities(prev => prev.map(c =>
      c.id === id ? { ...c, [field]: dbValue, _saving: field, _saved: null, _error: null } : c
    ))
    const { error } = await supabase.from('communities').update({ [field]: dbValue }).eq('id', id)
    setCommunities(prev => prev.map(c =>
      c.id === id
        ? { ...c, _saving: null, _saved: error ? null : field, _error: error?.message ?? null }
        : c
    ))
    if (!error) {
      setTimeout(() => setCommunities(prev => prev.map(c =>
        c.id === id ? { ...c, _saved: null } : c
      )), 2000)
    } else {
      setTimeout(() => setCommunities(prev => prev.map(c =>
        c.id === id ? { ...c, _error: null } : c
      )), 4000)
    }
  }, [])

  if (loading) {
    return <div className="text-center py-10 text-sm text-gray-400">Loading communities…</div>
  }

  const mapped = communities.filter(c => c.lat && c.lng).length
  const unmapped = communities.length - mapped

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Community Map Configuration</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Set GPS coordinates and assign area managers. Communities with coordinates appear as pins on the Coverage Map.
          </p>
        </div>
        <div className="flex gap-2 text-sm flex-shrink-0">
          <span className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 text-green-700 border border-green-200 rounded-lg whitespace-nowrap">
            <MapPin className="w-3.5 h-3.5" /> {mapped} mapped
          </span>
          {unmapped > 0 && (
            <span className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg whitespace-nowrap">
              {unmapped} need coordinates
            </span>
          )}
        </div>
      </div>

      <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
        <strong>Coordinate format:</strong> Enter decimal degrees (e.g. <code className="bg-blue-100 px-1 rounded">29.7604</code> lat, <code className="bg-blue-100 px-1 rounded">-95.3698</code> lng).
        Greater Houston range: lat 29.3–30.4, lng −94.7 to −96.1.
        Find coordinates at <strong>maps.google.com</strong> → right-click your location → copy the numbers shown.
      </div>

      {managers.length === 0 && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
          No area managers set up yet. Go to <strong>User Management</strong> and toggle the <strong>Map Mgr</strong> switch on for each person.
        </div>
      )}

      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium text-gray-500 text-xs">Community</th>
              <th className="px-4 py-2.5 text-left font-medium text-gray-500 text-xs w-20">Code</th>
              <th className="px-4 py-2.5 text-left font-medium text-gray-500 text-xs w-16">Brand</th>
              <th className="px-4 py-2.5 text-left font-medium text-gray-500 text-xs w-36">Latitude</th>
              <th className="px-4 py-2.5 text-left font-medium text-gray-500 text-xs w-36">Longitude</th>
              <th className="px-4 py-2.5 text-left font-medium text-gray-500 text-xs">Area Manager</th>
              <th className="px-4 py-2.5 w-8"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {communities.map(c => (
              <CommunityRow
                key={c.id}
                community={c}
                managers={managers}
                onUpdate={handleUpdate}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const CommunityRow = memo(function CommunityRow({ community: c, managers, onUpdate }) {
  const [lat, setLat] = useState(c.lat?.toString() ?? '')
  const [lng, setLng] = useState(c.lng?.toString() ?? '')
  const [latErr, setLatErr] = useState('')
  const [lngErr, setLngErr] = useState('')

  useEffect(() => { setLat(c.lat?.toString() ?? '') }, [c.lat])
  useEffect(() => { setLng(c.lng?.toString() ?? '') }, [c.lng])

  const brandLabel = c.brand?.toLowerCase().includes('starlight') ? 'SL' : 'AW'
  const brandCls = brandLabel === 'SL' ? 'bg-pink-100 text-pink-700' : 'bg-blue-100 text-blue-700'
  const isPinned = c.lat && c.lng

  function commitLat() {
    const val = lat.trim()
    if (val === '') {
      setLatErr('')
      onUpdate(c.id, 'lat', '')
      return
    }
    const num = parseFloat(val)
    if (isNaN(num)) {
      setLatErr('Must be a number')
      return
    }
    if (num < -90 || num > 90) {
      setLatErr('Lat must be −90 to 90. Houston is ~29.7')
      return
    }
    setLatErr('')
    onUpdate(c.id, 'lat', num)
  }

  function commitLng() {
    const val = lng.trim()
    if (val === '') {
      setLngErr('')
      onUpdate(c.id, 'lng', '')
      return
    }
    const num = parseFloat(val)
    if (isNaN(num)) {
      setLngErr('Must be a number')
      return
    }
    if (num < -180 || num > 180) {
      setLngErr('Lng must be −180 to 180. Houston is ~−95.4')
      return
    }
    setLngErr('')
    onUpdate(c.id, 'lng', num)
  }

  const isSaving = c._saving != null
  const isSaved = c._saved != null
  const isError = c._error != null

  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-2">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isPinned ? 'bg-green-500' : 'bg-gray-300'}`} />
          <span className="font-medium text-gray-900 text-sm">{c.name}</span>
        </div>
      </td>
      <td className="px-4 py-2 font-mono text-xs text-gray-400">{c.code}</td>
      <td className="px-4 py-2">
        <span className={`text-xs font-bold px-2 py-0.5 rounded ${brandCls}`}>{brandLabel}</span>
      </td>
      <td className="px-4 py-2">
        <div>
          <input
            type="text"
            inputMode="decimal"
            value={lat}
            onChange={e => { setLat(e.target.value); setLatErr('') }}
            onBlur={commitLat}
            onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
            placeholder="29.7604"
            className={`w-full px-2 py-1.5 border rounded text-xs font-mono focus:outline-none focus:ring-1 ${
              latErr
                ? 'border-red-400 focus:border-red-400 focus:ring-red-300'
                : 'border-gray-200 focus:border-blue-400 focus:ring-blue-300'
            }`}
          />
          {latErr && <p className="text-xs text-red-600 mt-0.5 leading-tight">{latErr}</p>}
        </div>
      </td>
      <td className="px-4 py-2">
        <div>
          <input
            type="text"
            inputMode="decimal"
            value={lng}
            onChange={e => { setLng(e.target.value); setLngErr('') }}
            onBlur={commitLng}
            onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
            placeholder="-95.3698"
            className={`w-full px-2 py-1.5 border rounded text-xs font-mono focus:outline-none focus:ring-1 ${
              lngErr
                ? 'border-red-400 focus:border-red-400 focus:ring-red-300'
                : 'border-gray-200 focus:border-blue-400 focus:ring-blue-300'
            }`}
          />
          {lngErr && <p className="text-xs text-red-600 mt-0.5 leading-tight">{lngErr}</p>}
        </div>
      </td>
      <td className="px-4 py-2">
        <select
          value={c.area_manager_id ?? ''}
          onChange={e => onUpdate(c.id, 'area_manager_id', e.target.value || null)}
          className="w-full px-2 py-1.5 border border-gray-200 rounded text-xs focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-300 bg-white"
        >
          <option value="">— Unassigned —</option>
          {managers.map(m => (
            <option key={m.id} value={m.id}>{m.full_name}</option>
          ))}
        </select>
      </td>
      <td className="px-4 py-2 text-center w-8">
        {isSaving && (
          <div className="w-4 h-4 border-2 border-blue-200 border-t-blue-500 rounded-full animate-spin mx-auto" />
        )}
        {!isSaving && isSaved && (
          <CheckCircle className="w-4 h-4 text-green-500 mx-auto" />
        )}
        {!isSaving && isError && (
          <AlertCircle className="w-4 h-4 text-red-500 mx-auto" title={c._error} />
        )}
      </td>
    </tr>
  )
})
