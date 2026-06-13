import * as XLSX from 'xlsx'

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

function processRawRows(rows) {
  // Find the "Cost Code" row (may be preceded by metadata rows)
  let headerIdx = -1
  for (let i = 0; i < Math.min(20, rows.length); i++) {
    if (String(rows[i][0]).trim() === 'Cost Code') { headerIdx = i; break }
  }
  if (headerIdx === -1) return null

  const communityCodes = rows[headerIdx].slice(1)
    .map(c => String(c || '').trim()).filter(Boolean)

  const vendorMap = new Map()
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i]
    const costCode = String(row[0] || '').trim()
    if (!costCode || !/^\d+$/.test(costCode)) continue

    for (let j = 1; j < row.length; j++) {
      const cell = String(row[j] || '').trim()
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

// XLSX variant — uses raw 2D array so metadata rows don't interfere
export function parseJCVendorReportXLSX(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const workbook = XLSX.read(e.target.result, { type: 'array' })
        const sheetName = workbook.SheetNames[0]
        const sheet = workbook.Sheets[sheetName]
        // header:1 → array of arrays, no key processing
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
        resolve(processRawRows(rows))
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}
