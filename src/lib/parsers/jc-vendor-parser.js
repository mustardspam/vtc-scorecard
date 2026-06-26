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

/** JC report column headers are "CODE Community Name" — extract the short code and display name. */
export function parseCommunityHeader(header) {
  const trimmed = String(header || '').trim()
  if (!trimmed) return { code: '', name: '' }
  const spaceIdx = trimmed.indexOf(' ')
  if (spaceIdx === -1) return { code: trimmed, name: trimmed }
  const code = trimmed.slice(0, spaceIdx).trim()
  const name = trimmed.slice(spaceIdx + 1).trim()
  return { code, name: name || code }
}

function communitiesFromHeaders(headers) {
  const byCode = new Map()
  for (const header of headers) {
    const { code, name } = parseCommunityHeader(header)
    if (!code) continue
    if (!byCode.has(code)) byCode.set(code, { code, name })
  }
  return Array.from(byCode.values())
}

function parseVendorRows(headerCells, rowIterator) {
  const communityHeaders = headerCells.slice(1).map(c => String(c || '').trim()).filter(Boolean)
  const communityByCol = communityHeaders.map(h => parseCommunityHeader(h))
  const vendorMap = new Map()

  for (const cells of rowIterator) {
    const costCode = String(cells[0] || '').trim()
    if (!costCode || !/^\d+$/.test(costCode)) continue

    for (let j = 1; j < cells.length; j++) {
      const cell = String(cells[j] || '').trim()
      if (!cell) continue
      const spaceIdx = cell.indexOf(' ')
      if (spaceIdx === -1) continue
      const jcId = cell.substring(0, spaceIdx).trim()
      const vendorName = cell.substring(spaceIdx + 1).trim()
      if (!jcId || !vendorName || !/^\d+$/.test(jcId)) continue

      const community = communityByCol[j - 1]
      if (!community?.code) continue

      if (!vendorMap.has(jcId)) {
        vendorMap.set(jcId, { jcVendorId: jcId, name: vendorName, assignments: [] })
      }
      const vendor = vendorMap.get(jcId)
      const exists = vendor.assignments.some(
        a => a.communityCode === community.code && a.costCode === costCode
      )
      if (!exists) vendor.assignments.push({ communityCode: community.code, costCode })
    }
  }

  return {
    communities: communitiesFromHeaders(communityHeaders),
    vendors: Array.from(vendorMap.values()),
  }
}

export function parseJCVendorReport(text) {
  const lines = text.split('\n').map(l => l.replace(/\r$/, ''))

  let headerIdx = -1
  for (let i = 0; i < Math.min(20, lines.length); i++) {
    const cells = parseCSVLine(lines[i])
    if (cells[0]?.trim() === 'Cost Code') { headerIdx = i; break }
  }
  if (headerIdx === -1) return null

  const headerCells = parseCSVLine(lines[headerIdx])
  const rows = []
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    rows.push(parseCSVLine(line))
  }

  return parseVendorRows(headerCells, rows)
}

function processRawRows(rows) {
  let headerIdx = -1
  for (let i = 0; i < Math.min(20, rows.length); i++) {
    if (String(rows[i][0]).trim() === 'Cost Code') { headerIdx = i; break }
  }
  if (headerIdx === -1) return null

  return parseVendorRows(rows[headerIdx], rows.slice(headerIdx + 1))
}

export function parseJCVendorReportXLSX(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const workbook = XLSX.read(e.target.result, { type: 'array' })
        const sheetName = workbook.SheetNames[0]
        const sheet = workbook.Sheets[sheetName]
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
