import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { Search, ChevronDown, ChevronUp, Database, Trash2 } from 'lucide-react'
import { cn } from '../lib/cn'
import CategoryChip from '../components/ui/CategoryChip'
import { categoryChipStyle, BRAND_CHIPS, TYPE_CHIPS } from '../lib/design/tokens'
import { formatJcVendorIds } from '../lib/formatJcVendorIds'

export default function DataPage() {
  const [tab, setTab] = useState('vendors')
  const [vendors, setVendors] = useState([])
  const [communities, setCommunities] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterBrand, setFilterBrand] = useState('')
  const [selectedVendorIds, setSelectedVendorIds] = useState(new Set())
  const [deleting, setDeleting] = useState(false)
  const { isManager } = useAuth()
  const canEdit = isManager()

  useEffect(() => {
    let mounted = true
    loadData(mounted)
    return () => { mounted = false }
  }, [])

  async function loadData(mounted = true) {
    setLoading(true)
    try {
      const [vRes, cRes, catRes] = await Promise.all([
        supabase.from('vendors').select(`
          id, name, is_active, is_trade, category_id,
          vendor_categories(id, name),
          vendor_brand_references(brand, jc_vendor_id),
          vendor_community_assignments(
            cost_code,
            communities(id, name, code, brand)
          )
        `).eq('is_active', true).order('name'),
        supabase.from('communities').select(`
          id, name, code, brand, is_active,
          vendor_community_assignments(
            cost_code,
            vendors(id, name, is_trade, vendor_categories(name), vendor_brand_references(brand, jc_vendor_id))
          )
        `).eq('is_active', true).order('name'),
        supabase.from('vendor_categories').select('*').order('sort_order'),
      ])
      if (vRes.error) throw vRes.error
      if (cRes.error) throw cRes.error
      if (catRes.error) throw catRes.error
      if (mounted) {
        setVendors(vRes.data || [])
        setCommunities(cRes.data || [])
        setCategories(catRes.data || [])
      }
    } catch (err) {
      console.error('DataPage loadData error:', err)
    } finally {
      if (mounted) setLoading(false)
    }
  }

  function toggleVendorSelect(id) {
    setSelectedVendorIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleSelectAll(visibleIds) {
    setSelectedVendorIds(prev => {
      const allSelected = visibleIds.every(id => prev.has(id))
      if (allSelected) {
        const next = new Set(prev)
        visibleIds.forEach(id => next.delete(id))
        return next
      }
      return new Set([...prev, ...visibleIds])
    })
  }

  async function deleteSelectedVendors() {
    if (selectedVendorIds.size === 0) return
    const ids = [...selectedVendorIds]
    const names = vendors.filter(v => ids.includes(v.id)).map(v => v.name)
    const confirmed = window.confirm(
      `Delete ${ids.length} vendor${ids.length !== 1 ? 's' : ''}?\n\n${names.slice(0, 10).join('\n')}${names.length > 10 ? `\n…and ${names.length - 10} more` : ''}\n\nThis cannot be undone.`
    )
    if (!confirmed) return
    setDeleting(true)
    const { error } = await supabase.from('vendors').delete().in('id', ids)
    setDeleting(false)
    if (error) {
      alert(
        'Could not delete the selected vendors:\n\n' + error.message +
        '\n\nVendors with existing scores, assignments, or feedback may need those records removed first.'
      )
      return
    }
    setVendors(prev => prev.filter(v => !ids.includes(v.id)))
    setSelectedVendorIds(new Set())
  }

  async function updateVendorCategory(vendorId, categoryId, categoryName) {
    // Optimistic update
    setVendors(prev => prev.map(v => v.id === vendorId
      ? { ...v, category_id: categoryId, vendor_categories: { id: categoryId, name: categoryName } }
      : v
    ))
    const { error } = await supabase.from('vendors').update({ category_id: categoryId }).eq('id', vendorId)
    if (error) {
      alert('Could not update category: ' + error.message)
      loadData() // revert optimistic update
    }
  }

  const filteredVendors = vendors.filter(v => {
    const q = search.toLowerCase()
    const matchSearch = !search ||
      v.name.toLowerCase().includes(q) ||
      (v.vendor_brand_references || []).some(r => r.jc_vendor_id.includes(q))
    const matchCat = !filterCategory || v.vendor_categories?.name === filterCategory
    const matchBrand = !filterBrand ||
      (v.vendor_brand_references || []).some(r => r.brand === filterBrand)
    return matchSearch && matchCat && matchBrand
  })

  const filteredCommunities = communities.filter(c => {
    const q = search.toLowerCase()
    const matchSearch = !search ||
      c.name.toLowerCase().includes(q) ||
      c.code.toLowerCase().includes(q)
    const matchBrand = !filterBrand || c.brand === filterBrand
    return matchSearch && matchBrand
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database className="w-6 h-6" style={{ color: 'var(--g-dim)' }} />
          <h1 className="glass-page-title">Vendor & Trade Directory</h1>
        </div>
        <span className="glass-page-subtitle">{vendors.length} vendors · {communities.length} communities</span>
      </div>

      <div className="flex gap-1 border-b overflow-x-auto" style={{ borderColor: 'var(--g-line)' }}>
        {[
          { id: 'vendors', label: 'By Vendor / Trade' },
          { id: 'communities', label: 'By Community' },
        ].map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => { setTab(t.id); setSearch('') }}
            className={cn('px-4 py-2.5 text-sm whitespace-nowrap', tab === t.id ? 'glass-tab-active' : 'glass-tab')}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--g-dim)' }} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={tab === 'vendors' ? 'Search name, JC ID, or community...' : 'Search community name or code...'}
            className="glass-input pl-9 w-72"
          />
        </div>

        <select value={filterBrand} onChange={e => setFilterBrand(e.target.value)} className="glass-input text-sm">
          <option value="">All Brands</option>
          <option value="Ashton Woods">Ashton Woods</option>
          <option value="Starlight">Starlight</option>
        </select>

        {tab === 'vendors' && (
          <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className="glass-input text-sm">
            <option value="">All Categories</option>
            {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
          </select>
        )}

        {(search || filterBrand || filterCategory) && (
          <button type="button" onClick={() => { setSearch(''); setFilterBrand(''); setFilterCategory('') }} className="glass-link text-xs bg-transparent border-none cursor-pointer">
            Clear filters
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="app-loading-spinner" /></div>
      ) : tab === 'vendors' ? (
        <VendorList
          vendors={filteredVendors}
          categories={categories}
          onCategoryChange={updateVendorCategory}
          selectedIds={selectedVendorIds}
          onToggleSelect={toggleVendorSelect}
          onToggleSelectAll={toggleSelectAll}
          onDeleteSelected={deleteSelectedVendors}
          deleting={deleting}
          canEdit={canEdit}
        />
      ) : (
        <CommunityList communities={filteredCommunities} />
      )}
    </div>
  )
}

function CategoryBadge({ vendorId, categoryName, categories, onCategoryChange, canEdit = true }) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const selectRef = useRef(null)

  const chipStyle = categoryChipStyle(categoryName || '')

  if (!canEdit) {
    return categoryName ? <CategoryChip name={categoryName} /> : (
      <span className="glass-category-chip" style={{ background: 'var(--g-panel-2)', color: 'var(--g-dim)' }}>No category</span>
    )
  }

  async function handleChange(e) {
    const cat = categories.find(c => c.name === e.target.value)
    if (!cat || cat.name === categoryName) { setEditing(false); return }
    setSaving(true)
    await onCategoryChange(vendorId, cat.id, cat.name)
    setSaving(false)
    setEditing(false)
  }

  if (editing) {
    return (
      <select
        ref={selectRef}
        autoFocus
        defaultValue={categoryName || ''}
        onChange={handleChange}
        onBlur={() => setEditing(false)}
        onClick={e => e.stopPropagation()}
        className="glass-input text-xs rounded-full px-2 py-0.5 cursor-pointer"
        style={{ minWidth: 110 }}
      >
        <option value="" disabled>— pick category —</option>
        {categories.map(c => (
          <option key={c.id} value={c.name}>{c.name}</option>
        ))}
      </select>
    )
  }

  return (
    <button
      onClick={e => { e.stopPropagation(); setEditing(true) }}
      title="Click to change category"
      className="glass-category-chip cursor-pointer transition-opacity hover:opacity-80"
      style={chipStyle}
    >
      {saving ? '…' : (categoryName || 'No category')}
    </button>
  )
}

function VendorList({ vendors, categories, onCategoryChange, selectedIds, onToggleSelect, onToggleSelectAll, onDeleteSelected, deleting, canEdit }) {
  const [expandedId, setExpandedId] = useState(null)

  const visibleIds = vendors.map(v => v.id)
  const allSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.has(id))
  const someSelected = visibleIds.some(id => selectedIds.has(id))
  const selectedCount = visibleIds.filter(id => selectedIds.has(id)).length

  if (vendors.length === 0) {
    return (
      <div className="glass-panel p-10 text-center">
        <p className="text-sm text-gray-500">No vendors found.</p>
        <p className="text-xs text-gray-400 mt-1">Upload a JC Vendor Report in the Uploads section to populate the directory.</p>
      </div>
    )
  }

  return (
    <div className="glass-panel overflow-hidden">

      {/* Bulk action bar — admins/managers only */}
      {canEdit && (
        <div className={`flex items-center gap-3 px-4 py-2 border-b transition-colors ${someSelected ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-100'}`}>
          <input
            type="checkbox"
            checked={allSelected}
            ref={el => { if (el) el.indeterminate = someSelected && !allSelected }}
            onChange={() => onToggleSelectAll(visibleIds)}
            className="w-4 h-4 rounded border-gray-300 accent-red-600 cursor-pointer"
            title={allSelected ? 'Deselect all' : 'Select all'}
          />
          {someSelected ? (
            <>
              <span className="text-sm font-medium text-red-700">{selectedCount} selected</span>
              <button
                onClick={onDeleteSelected}
                disabled={deleting}
                className="flex items-center gap-1.5 px-3 py-1 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {deleting ? 'Deleting…' : `Delete ${selectedCount}`}
              </button>
            </>
          ) : (
            <span className="text-xs text-gray-400">Select vendors to delete</span>
          )}
        </div>
      )}

      <div className="divide-y divide-gray-100">
        {vendors.map(v => {
          const isExpanded = expandedId === v.id
          const isSelected = selectedIds.has(v.id)
          const assignments = v.vendor_community_assignments || []
          const brandRefs = v.vendor_brand_references || []

          const communityMap = new Map()
          assignments.forEach(a => {
            if (a.communities?.id) {
              if (!communityMap.has(a.communities.id)) {
                communityMap.set(a.communities.id, { ...a.communities, costCodes: [] })
              }
              communityMap.get(a.communities.id).costCodes.push(a.cost_code)
            }
          })
          const uniqueCommunities = Array.from(communityMap.values())

          return (
            <div key={v.id} className={isSelected ? 'bg-red-50' : ''}>
              <div
                className={`px-4 py-3 cursor-pointer transition-colors ${isSelected ? 'hover:bg-red-100' : 'hover:bg-gray-50'}`}
                onClick={() => setExpandedId(isExpanded ? null : v.id)}
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {canEdit && (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggleSelect(v.id)}
                        onClick={e => e.stopPropagation()}
                        className="w-4 h-4 rounded border-gray-300 accent-red-600 cursor-pointer flex-shrink-0"
                      />
                    )}
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      <span className="text-sm font-semibold text-gray-900">{v.name}</span>

                      <CategoryBadge
                        vendorId={v.id}
                        categoryName={v.vendor_categories?.name}
                        categories={categories}
                        onCategoryChange={onCategoryChange}
                        canEdit={canEdit}
                      />

                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        v.is_trade ? 'bg-indigo-100 text-indigo-700' : 'bg-purple-100 text-purple-700'
                      }`}>
                        {v.is_trade ? 'Trade' : 'Vendor'}
                      </span>

                      {formatJcVendorIds(brandRefs) && (
                        <span className="text-xs text-gray-500">
                          <span className="font-medium text-gray-600">Vendor ID:</span>{' '}
                          <span className="font-mono">{formatJcVendorIds(brandRefs)}</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {isExpanded
                    ? <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    : <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  }
                </div>
              </div>

              {isExpanded && (
                <div className="pl-11 pr-4 pb-4 bg-gray-50 border-t border-gray-100 space-y-4 pt-3">
                  {brandRefs.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 mb-1.5">JC Vendor IDs</p>
                      <div className="flex gap-2 flex-wrap">
                        {brandRefs.map(r => (
                          <div key={r.jc_vendor_id} className="flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs">
                            <span className={`font-medium ${r.brand === 'Starlight' ? 'text-yellow-700' : 'text-blue-700'}`}>
                              {r.brand}
                            </span>
                            <span className="font-mono text-gray-800">{r.jc_vendor_id}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {uniqueCommunities.length > 0 ? (
                    <div>
                      <p className="text-xs font-medium text-gray-500 mb-2">
                        Active in {uniqueCommunities.length} communit{uniqueCommunities.length === 1 ? 'y' : 'ies'}
                      </p>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                        {uniqueCommunities.map(c => (
                          <div key={c.id} className="px-3 py-2 bg-white border border-gray-200 rounded-lg">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-mono font-medium text-gray-700">{c.code}</span>
                              {c.brand && (
                                <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                                  c.brand === 'Starlight' ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-700'
                                }`}>{c.brand === 'Starlight' ? 'SL' : 'AW'}</span>
                              )}
                            </div>
                            {c.name && c.name !== c.code && (
                              <p className="text-xs text-gray-500 mt-0.5">{c.name}</p>
                            )}
                            <p className="text-xs text-gray-400 mt-0.5">
                              Codes: {c.costCodes.sort().join(', ')}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400">
                      No community assignments yet — upload a JC Vendor Report to populate.
                    </p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="px-4 py-2 border-t border-gray-100 bg-gray-50">
        <p className="text-xs text-gray-400">{vendors.length} vendor{vendors.length !== 1 ? 's' : ''}</p>
      </div>
    </div>
  )
}

function CommunityList({ communities }) {
  const [expandedId, setExpandedId] = useState(null)

  if (communities.length === 0) {
    return (
      <div className="glass-panel p-10 text-center">
        <p className="text-sm text-gray-500">No communities found.</p>
        <p className="text-xs text-gray-400 mt-1">Upload a JC Vendor Report to populate the directory.</p>
      </div>
    )
  }

  return (
    <div className="glass-panel overflow-hidden">
      <div className="divide-y divide-gray-100">
        {communities.map(c => {
          const isExpanded = expandedId === c.id
          const assignments = c.vendor_community_assignments || []

          const vendorMap = new Map()
          assignments.forEach(a => {
            if (a.vendors?.id) {
              if (!vendorMap.has(a.vendors.id)) {
                vendorMap.set(a.vendors.id, { ...a.vendors, costCodes: [] })
              }
              vendorMap.get(a.vendors.id).costCodes.push(a.cost_code)
            }
          })
          const uniqueVendors = Array.from(vendorMap.values())
            .sort((a, b) => a.name.localeCompare(b.name))

          return (
            <div key={c.id}>
              <div
                className="px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => setExpandedId(isExpanded ? null : c.id)}
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-900">
                        {c.name && c.name !== c.code ? c.name : c.code}
                      </span>
                      <span className="text-xs font-mono bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                        {c.code}
                      </span>
                      {c.brand && (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          c.brand === 'Starlight'
                            ? 'bg-yellow-100 text-yellow-700'
                            : 'bg-blue-100 text-blue-700'
                        }`}>{c.brand}</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {uniqueVendors.length} vendor{uniqueVendors.length !== 1 ? 's' : ''} assigned
                    </p>
                  </div>
                  {isExpanded
                    ? <ChevronUp className="w-4 h-4 text-gray-400" />
                    : <ChevronDown className="w-4 h-4 text-gray-400" />
                  }
                </div>
              </div>

              {isExpanded && (
                <div className="px-4 pb-4 bg-gray-50 border-t border-gray-100 pt-3">
                  {uniqueVendors.length > 0 ? (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-gray-500 mb-2">Assigned Vendors & Trades</p>
                      {uniqueVendors.map(v => {
                        const catName = v.vendor_categories?.name
                        const jcIds = formatJcVendorIds(v.vendor_brand_references)
                        return (
                          <div key={v.id} className="flex items-center justify-between px-3 py-2 rounded-lg" style={{ background: 'var(--g-panel-2)', border: '1px solid var(--g-line)' }}>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium truncate" style={{ color: 'var(--g-text)' }}>{v.name}</p>
                              {jcIds && (
                                <p className="text-xs mt-0.5" style={{ color: 'var(--g-dim)' }}>
                                  <span className="font-medium">Vendor ID:</span>{' '}
                                  <span className="font-mono">{jcIds}</span>
                                </p>
                              )}
                              <div className="flex items-center gap-1.5 mt-0.5">
                                {catName && <CategoryChip name={catName} />}
                                <span className="glass-category-chip" style={{ background: (v.is_trade ? TYPE_CHIPS.Trade : TYPE_CHIPS.Vendor).bg, color: (v.is_trade ? TYPE_CHIPS.Trade : TYPE_CHIPS.Vendor).text }}>
                                  {v.is_trade ? 'Trade' : 'Vendor'}
                                </span>
                              </div>
                            </div>
                            <div className="flex gap-1 flex-wrap justify-end ml-3 max-w-36 flex-shrink-0">
                              {v.costCodes.sort().slice(0, 4).map(cc => (
                                <span key={cc} className="text-xs font-mono bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                                  {cc}
                                </span>
                              ))}
                              {v.costCodes.length > 4 && (
                                <span className="text-xs text-gray-400">+{v.costCodes.length - 4}</span>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400">No vendor assignments yet.</p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="px-4 py-2 border-t border-gray-100 bg-gray-50">
        <p className="text-xs text-gray-400">{communities.length} communit{communities.length !== 1 ? 'ies' : 'y'}</p>
      </div>
    </div>
  )
}
