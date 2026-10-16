/**
 * Minimal RFC-4180-ish CSV parser.
 *
 * Handles:
 * - quoted fields ("...")
 * - escaped quotes inside quoted fields ("" -> ")
 * - commas inside quoted fields
 * - CRLF / LF line endings
 * - a header row (first line)
 *
 * Returns an array of objects keyed by the header names.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false

  const pushField = () => {
    row.push(field)
    field = ''
  }
  const pushRow = () => {
    pushField()
    // Skip completely empty rows
    if (row.length > 1 || (row.length === 1 && row[0].trim() !== '')) {
      rows.push(row)
    }
    row = []
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      pushField()
    } else if (ch === '\n') {
      pushRow()
    } else if (ch === '\r') {
      // ignore; handle \r\n and lone \r
    } else {
      field += ch
    }
  }
  // flush last field/row
  if (field.length > 0 || row.length > 0) pushRow()

  if (rows.length === 0) return []

  const header = rows[0].map((h) => h.trim())
  const result: Record<string, string>[] = []

  for (let r = 1; r < rows.length; r++) {
    const values = rows[r]
    const obj: Record<string, string> = {}
    for (let c = 0; c < header.length; c++) {
      obj[header[c]] = values[c] ?? ''
    }
    result.push(obj)
  }

  return result
}
