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

export function matchVendors(rawNames, vendorList, aliases = []) {
  const results = []
  const aliasMap = new Map(aliases.map(a => [normalize(a.alias_name), a.vendor_id]))

  for (const rawName of rawNames) {
    if (!rawName) continue
    const normalizedRaw = normalize(rawName)

    const aliasVendorId = aliasMap.get(normalizedRaw)
    if (aliasVendorId) {
      const vendor = vendorList.find(v => v.id === aliasVendorId)
      if (vendor) {
        results.push({ rawName, matchedVendor: vendor, confidence: 1.0, source: 'alias' })
        continue
      }
    }

    const exact = vendorList.find(v => v.name === rawName)
    if (exact) {
      results.push({ rawName, matchedVendor: exact, confidence: 1.0, source: 'exact' })
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
      if (score > bestScore) {
        bestScore = score
        bestMatch = vendor
      }
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
