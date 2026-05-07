import Papa from 'papaparse'

export function parseCSV(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: true,
      complete: (results) => {
        resolve({
          headers: results.meta.fields || [],
          rows: results.data,
          errors: results.errors,
        })
      },
      error: (err) => reject(err),
    })
  })
}
