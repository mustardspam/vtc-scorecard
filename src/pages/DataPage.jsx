import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Search, ChevronDown, ChevronUp, Database } from 'lucide-react'

export default function DataPage() {
  const [tab, setTab] = useState('vendors')
  const [vendors, setVendors] = useState([])
  const [communities, setCommunities] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterBrand, setFilterBrand] = useState('')

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const [vRes, cRes, catRes] = await Promise.all([
      supabase.from('vendors').select(`
        id, name, is_active, is_trade,
        vendor_categories(name),
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
          vendors(id, name, is_trade, vendor_categories(name))
        )
      `).eq('is_active', true).order('name'),
      supabase.from('vendor_categories').select('*').order('name'),
    ])
    setVendors(vRes.data || [])
    setCommunities(cRes.data || [])
    setCategories(catRes.data || [])
    setLoading(false)
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
          <Database className="w-6 h-6 text-gray-700" />
          <h1 className="text-2xl font-bold text-gray-900">Vendor & Trade Directory</h1>
        </div>
        <span className="text-sm text-gray-400">{vendors.length} vendors · {communities.length} communities</span>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-200 pb-px">
        {[
          { id: 'vendors', label: 'By Vendor / Trade' },
          { id: 'communities', label: 'By Community' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => { setTab(t.id); setSearch('') }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={tab === 'vendors' ? 'Search vendor name or JC ID...' : 'Search community name or code...'}
            className="pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 w-72"
          />
        </div>

        <select
          value={filterBrand}
          onChange={e => setFilterBrand(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white outline-none"
        >
          <option value="">All Brands</option>
          <option value="Ashton Woods">Ashton Woods</option>
          <option value="Starlight">Starlight</option>
        </select>

        {tab === 'vendors' && (
          <select
            value={filterCategory}
            onChange={e => setFilterCategory(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white outline-none"
          >
            <option value="">All Categories</option>
            {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
          </select>
        )}

        {(search || filterBrand || filterCategory) && (
          <button
            onClick={() => { setSearch(''); setFilterBrand(''); setFilterCategory('') }}
            className="text-xs text-gray-500 hover:text-gray-700 underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : tab === 'vendors' ? (
        <VendorList vendors={filteredVendors} />
      ) : (
        <CommunityList communities={filteredCommunities} />
      )}
    </div>
  )
}

function VendorList({ vendors }) {
  const [expandedId, setExpandedId] = useState(null)

  if (vendors.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
        <p className="text-sm text-gray-500">No vendors found.</p>
        <p className="text-xs text-gray-400 mt-1">Upload a JC Vendor Report in the Uploads section to populate the directory.</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="divide-y divide-gray-100">
        {vendors.map(v => {
          const isExpanded = expandedId === v.id
          const assignments = v.vendor_community_assignments || []
          const brandRefs = v.vendor_brand_references || []

          // Unique communities from assignments
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
            <div key={v.id}>
              <div
                className="px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => setExpandedId(isExpanded ? null : v.id)}
              >
                <div className="flex items-start justify-between gap-4">
                  {/* Left: name + badges + JC IDs */}
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-900">{v.name}</span>
                      {v.vendor_categories?.name && (
                        <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full">
                          {v.vendor_categories.name}
                        </span>
                      )}
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        v.is_trade ? 'bg-indigo-100 text-indigo-700' : 'bg-purple-100 text-purple-700'
                      }`}>
                        {v.is_trade ? 'Trade' : 'Vendor'}
                      </span>
                    </div>

                    {brandRefs.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {brandRefs.map(r => (
                          <span key={r.jc_vendor_id} className={`text-xs font-mono px-1.5 py-0.5 rounded border ${
                            r.brand === 'Starlight'
                              ? 'bg-yellow-50 text-yellow-800 border-yellow-200'
                              : 'bg-blue-50 text-blue-800 border-blue-200'
                          }`}>
                            {r.brand === 'Starlight' ? 'SL' : 'AW'}:{r.jc_vendor_id}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Right: community codes + expand */}
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {uniqueCommunities.length > 0 && (
                      <div className="flex items-center gap-1 flex-wrap justify-end max-w-52">
                        {uniqueCommunities.slice(0, 5).map(c => (
                          <span key={c.id} className="text-xs font-mono px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">
                            {c.code}
                          </span>
                        ))}
                        {uniqueCommunities.length > 5 && (
                          <span className="text-xs text-gray-400">+{uniqueCommunities.length - 5}</span>
                        )}
                      </div>
                    )}
                    {isExpanded
                      ? <ChevronUp className="w-4 h-4 text-gray-400" />
                      : <ChevronDown className="w-4 h-4 text-gray-400" />
                    }
                  </div>
                </div>
              </div>

              {isExpanded && (
                <div className="px-4 pb-4 bg-gray-50 border-t border-gray-100 space-y-4 pt-3">
                  {/* JC ID detail */}
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

                  {/* Community assignments */}
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
      <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
        <p className="text-sm text-gray-500">No communities found.</p>
        <p className="text-xs text-gray-400 mt-1">Upload a JC Vendor Report to populate the directory.</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="divide-y divide-gray-100">
        {communities.map(c => {
          const isExpanded = expandedId === c.id
          const assignments = c.vendor_community_assignments || []

          // Unique vendors from assignments
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
                      {uniqueVendors.map(v => (
                        <div key={v.id} className="flex items-center justify-between px-3 py-2 bg-white border border-gray-100 rounded-lg">
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-gray-800 truncate">{v.name}</p>
                            <p className="text-xs text-gray-400">
                              {v.vendor_categories?.name || 'No category'}
                              {' · '}
                              {v.is_trade ? 'Trade' : 'Vendor'}
                            </p>
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
                      ))}
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
