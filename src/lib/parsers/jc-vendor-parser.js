function parseCSVLine(line) {
  const cells = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      cells.push(current); current = ''
    } else {
      current += ch
    }
  }
  cells.push(current)
  return cells
}

export function parseJCVendorReport(text) {
  const lines = text.split('\n').map(l => l.replace(/\r$/, ''))

  // Find the data header line (contains "Cost Code" as first cell)
  let headerIdx = -1
  for (let i = 0; i < Math.min(20, lines.length); i++) {
    const cells = parseCSVLine(lines[i])
    if (cells[0]?.trim() === 'Cost Code') { headerIdx = i; break }
  }
  if (headerIdx === -1) return null

  const headerCells = parseCSVLine(lines[headerIdx])
  const communityCodes = headerCells.slice(1).map(c => c.trim()).filter(Boolean)

  // vendorId → { jcVendorId, name, assignments: [{communityCode, costCode}] }
  const vendorMap = new Map()

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const cells = parseCSVLine(line)
    const costCode = cells[0]?.trim()
    if (!costCode || !/^\d+$/.test(costCode)) continue

    for (let j = 1; j < cells.length; j++) {
      const cell = cells[j]?.trim()
      if (!cell) continue
      const spaceIdx = cell.indexOf(' ')
      if (spaceIdx === -1) continue
      const jcId = cell.substring(0, spaceIdx).trim()
      const vendorName = cell.substring(spaceIdx + 1).trim()
      if (!jcId || !vendorName || !/^\d+$/.test(jcId)) continue

      const communityCode = communityCodes[j - 1]
      if (!communityCode) continue

      if (!vendorMap.has(jcId)) {
        vendorMap.set(jcId, { jcVendorId: jcId, name: vendorName, assignments: [] })
      }
      const vendor = vendorMap.get(jcId)
      const exists = vendor.assignments.some(
        a => a.communityCode === communityCode && a.costCode === costCode
      )
      if (!exists) vendor.assignments.push({ communityCode, costCode })
    }
  }

  return {
    communities: communityCodes.map(code => ({ code, name: code })),
    vendors: Array.from(vendorMap.values()),
  }
}
