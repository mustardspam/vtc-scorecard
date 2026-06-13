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

export function matchVendors(rawNames, vendorList, aliases = [], brandRefs = []) {
  const results = []
  const aliasMap = new Map(aliases.map(a => [normalize(a.alias_name), a.vendor_id]))
  const jcIdMap = new Map(brandRefs.map(r => [r.jc_vendor_id, r.vendor_id]))

  for (const rawName of rawNames) {
    if (!rawName) continue

    // JC format: "{jcId} {vendor name}" — match by JC ID first
    const jcParts = extractJCParts(rawName)
    if (jcParts) {
      const vendorId = jcIdMap.get(jcParts.jcId)
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
