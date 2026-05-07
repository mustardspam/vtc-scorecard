import * as XLSX from 'xlsx'

export function parseXLSX(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const workbook = XLSX.read(e.target.result, { type: 'array' })
        const sheets = {}

        workbook.SheetNames.forEach(name => {
          const sheet = workbook.Sheets[name]
          const json = XLSX.utils.sheet_to_json(sheet, { defval: '' })
          const headers = json.length > 0 ? Object.keys(json[0]) : []
          sheets[name] = { headers, rows: json }
        })

        const firstSheet = workbook.SheetNames[0]
        resolve({
          sheetNames: workbook.SheetNames,
          sheets,
          headers: sheets[firstSheet]?.headers || [],
          rows: sheets[firstSheet]?.rows || [],
        })
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}
