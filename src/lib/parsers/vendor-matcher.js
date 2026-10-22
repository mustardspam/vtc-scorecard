import { stringSimilarity } from 'string-similarity-js'

function normalize(name) {
  if (!name) return ''
  return name
    .toLowerCase()
    .replace(/\b(llc|inc|corp|co|ltd|dba|l\.l\.c\.|company)\b/gi, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractJCParts(rawName) {
  if (!rawName) return null
  const match = rawName.trim().match(/^(\d+)\s+(.+)$/)
  if (!match) return null
  return { jcId: match[1], name: match[2].trim() }
}

export function matchVendors(rawNames, vendorList, aliases = [], brandRefs = [], { importBrand = null } = {}) {
  const results = []
  const aliasMap = new Map(aliases.map(a => [normalize(a.alias_name), a.vendor_id]))
  const jcIdMap = new Map()
  for (const r of brandRefs) {
    const key = importBrand ? `${r.brand}:${r.jc_vendor_id}` : r.jc_vendor_id
    if (!jcIdMap.has(key)) jcIdMap.set(key, r.vendor_id)
  }

  for (const rawName of rawNames) {
    if (!rawName) continue

    // JC format: "{jcId} {vendor name}" — match by JC ID first
    const jcParts = extractJCParts(rawName)
    if (jcParts) {
      const scopedKey = importBrand ? `${importBrand}:${jcParts.jcId}` : jcParts.jcId
      let vendorId = jcIdMap.get(scopedKey)
      if (!vendorId && importBrand) vendorId = jcIdMap.get(jcParts.jcId)
      if (vendorId) {
        const vendor = vendorList.find(v => v.id === vendorId)
        if (vendor) {
          results.push({ rawName, matchedVendor: vendor, confidence: 1.0, source: 'jc_id' })
          continue
        }
      }
    }

    // Use name-without-JC-prefix for subsequent matching
    const nameForMatching = jcParts ? jcParts.name : rawName
    const normalizedRaw = normalize(nameForMatching)

    const aliasVendorId = aliasMap.get(normalizedRaw)
    if (aliasVendorId) {
      const vendor = vendorList.find(v => v.id === aliasVendorId)
      if (vendor) {
        results.push({ rawName, matchedVendor: vendor, confidence: 1.0, source: 'alias' })
        continue
      }
    }

    const exact = vendorList.find(v => v.name === nameForMatching)
    if (exact) {
      results.push({ rawName, matchedVendor: exact, confidence: 1.0, source: 'exact' })
      continue
    }

    const lowerName = nameForMatching.toLowerCase().trim()
    const exactCi = vendorList.find(v => v.name.toLowerCase().trim() === lowerName)
    if (exactCi) {
      results.push({ rawName, matchedVendor: exactCi, confidence: 1.0, source: 'exact_ci' })
      continue
    }

    const normalizedExact = vendorList.find(v => normalize(v.name) === normalizedRaw)
    if (normalizedExact) {
      results.push({ rawName, matchedVendor: normalizedExact, confidence: 0.95, source: 'normalized' })
      continue
    }

    let bestMatch = null
    let bestScore = 0
    for (const vendor of vendorList) {
      const score = stringSimilarity(normalizedRaw, normalize(vendor.name))
      if (score > bestScore) { bestScore = score; bestMatch = vendor }
    }

    if (bestScore >= 0.7) {
      results.push({ rawName, matchedVendor: bestMatch, confidence: bestScore, source: 'fuzzy', needsConfirmation: true })
    } else {
      const candidates = vendorList
        .map(v => ({ vendor: v, score: stringSimilarity(normalizedRaw, normalize(v.name)) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
      results.push({ rawName, matchedVendor: null, confidence: 0, source: 'unmatched', candidates })
    }
  }

  return results
}

/** Auto-resolve a vendor during imports (JC reports, etc.) without manual review. */
export function resolveVendorForImport(rawName, vendorList, aliases = [], brandRefs = [], { fuzzyThreshold = 0.85, importBrand = null } = {}) {
  const [match] = matchVendors([rawName], vendorList, aliases, brandRefs, { importBrand })
  if (!match?.matchedVendor) return { vendor: null, match }
  if (!match.needsConfirmation) return { vendor: match.matchedVendor, match }
  if (match.confidence >= fuzzyThreshold) return { vendor: match.matchedVendor, match }
  return { vendor: null, match }
}

// ---- Safety OFIs (HB NEXT) ---------------------------------------------------
// Safety notices name the trade partner however the field manager typed it:
// "Vortex Conctere", "DR Kidd Roof", "BFS Windows", "CCI (Corporate Concrete)".
// Matching is on the distinctive words of the name (not the trade words), each of
// which must appear in the vendor's name: as a word, a word's start, a near-miss
// spelling, or the initials of its name.

// Trades: on its own, a name made of these ("Masonry", "HVAC / Mechanical") says
// which trade, not which company.
const TRADES = new Set(`
  roofing roof roofs drywall concrete flatwork plumbing plumber electric electrical mechanical hvac ac
  air conditioning heating masonry brick stone stucco trim windows window doors door glass mirror
  flooring floors floor framing framers painting paint insulation cabinets cabinetry cabinet countertops
  landscaping landscape fencing fence gutters gutter pest control foundation foundations sitework site
  excavation garage siding tile appliances lumber windstorm cleaning hardware general contractor
  contractors and of
`.split(/\s+/).filter(Boolean))
// Words a company name adds to say what form it takes ("Flooring Services", "ALT Construction").
const FORM_WORDS = new Set(`
  construction constructions services service builder builders supply supplies materials material
  delivery the houston texas tx group solutions systems enterprises enterprise holdings company
  companies crew residential
`.split(/\s+/).filter(Boolean))
// Neither kind says which company it is.
const TRADE_WORDS = new Set([...TRADES, ...FORM_WORDS])

/** "Builders FirstSource Inc" -> ["builders", "first", "source"] */
function words(name) {
  return normalize(String(name || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/&/g, ' and ')).split(' ').filter(Boolean)
}

/** Optimal string alignment distance (Levenshtein plus adjacent swaps). */
function editDistance(a, b, max = 3) {
  if (Math.abs(a.length - b.length) > max) return max + 1
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  }
  return d[a.length][b.length]
}

/** Spelling slack allowed for a word of this length. */
const slack = w => (w.length >= 7 ? 2 : w.length >= 5 ? 1 : 0)

/** A word of the set, or a misspelling of one ("conctere"). */
function inWords(w, set) {
  if (set.has(w)) return true
  if (!slack(w)) return false
  for (const t of set) if (editDistance(w, t, slack(w)) <= slack(w)) return true
  return false
}
const isTradeWord = w => inWords(w, TRADE_WORDS)

/** True when a name only says the trade ("Masonry", "HVAC / Mechanical") or is a category name. */
export function isTradeOnlyName(name, categories = []) {
  const ws = words(name)
  if (!ws.length) return true
  if (categories.some(c => normalize(c.name) === normalize(name))) return true
  return ws.every(w => inWords(w, TRADES))
}

function wordMatches(w, vendorWords, initials) {
  if (w.length >= 2 && w.length <= 4 && w === initials) return true
  return vendorWords.some(v => v === w
    || (w.length >= 3 && v.startsWith(w))
    || (slack(w) && editDistance(w, v, slack(w)) <= slack(w))
    || v === w.replace(/s$/, '') || w === v.replace(/s$/, ''))
}

/**
 * Company-name match for loosely typed names. Returns { vendor, candidates }:
 * vendor only when exactly one vendor name fits (duplicates of one name count once).
 */
export function matchCompanyName(rawName, vendorList) {
  const raw = String(rawName || '')
  // "CCI (Corporate Concrete)" -> try the whole name, "CCI", then "Corporate Concrete"
  const paren = /^(.*?)\s*\((.*)\)\s*$/.exec(raw)
  const variants = [raw, ...(paren ? [paren[1], paren[2]] : [])].filter(v => words(v).length)
  const vendorInfo = vendorList.map(v => {
    const ws = words(v.name)
    // Joined neighbours too, so "Hometeam" finds "HomeTeam" (split into "home team").
    const joined = ws.slice(1).map((w, i) => ws[i] + w)
    return { vendor: v, ws: [...ws, ...joined], initials: ws.filter(w => !['and', 'of', 'the'].includes(w)).map(w => w[0]).join('') }
  })
  for (const variant of variants) {
    const ws = words(variant)
    const distinctive = ws.filter(w => !isTradeWord(w))
    const required = distinctive.length ? distinctive : ws
    const fits = vendorInfo.filter(vi => required.every(w => wordMatches(w, vi.ws, vi.initials)))
    if (!fits.length) continue
    // Prefer the vendors that also share the trade words ("Dalco Roofing" over "Dalco Electric").
    const score = vi => ws.filter(w => wordMatches(w, vi.ws, vi.initials)).length
    const best = Math.max(...fits.map(score))
    const top = fits.filter(vi => score(vi) === best)
    if (new Set(top.map(vi => normalize(vi.vendor.name))).size === 1) return { vendor: top[0].vendor, candidates: [] }
    return { vendor: null, candidates: top.map(vi => vi.vendor).slice(0, 5) }
  }
  return { vendor: null, candidates: [] }
}

/**
 * Who an OFI is against. "Trade Type" is usually the company; when it only names the
 * trade ("Masonry"), the company is in "Subcontractor Involved".
 * Returns { vendor, name, source, tradeOnly }: name is the company as written (the
 * one to remember as an alias), or the trade when no company is named (tradeOnly).
 */
export function resolveOfiVendor(ofi, vendorList, aliases = [], categories = []) {
  const trade = (ofi.trade_type || '').trim()
  const sub = (ofi.subcontractor || '').trim()
  const names = (isTradeOnlyName(trade, categories) ? [sub] : [trade, sub]).filter(n => n && !isTradeOnlyName(n, categories))
  for (const name of names) {
    const { vendor, match } = resolveVendorForImport(name, vendorList, aliases)
    if (vendor) return { vendor, name, source: match.source, tradeOnly: false }
    const company = matchCompanyName(name, vendorList)
    if (company.vendor) return { vendor: company.vendor, name, source: 'name_words', tradeOnly: false }
  }
  return { vendor: null, name: names[0] || trade || sub || 'Unknown', source: 'unmatched', tradeOnly: !names.length }
}
