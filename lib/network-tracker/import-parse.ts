// lib/network-tracker/import-parse.ts
// SERVER-ONLY spreadsheet parsing for the import. XLSX via read-excel-file
// (maintained, robust — handles namespace-prefixed / tool-generated workbooks
// that exceljs could not), CSV via papaparse. Turns an uploaded Buffer into a
// normalised string grid, detects the header row, and pulls sample rows for the
// preview. See IMPORT.md §1, §2.

import readXlsxFile from "read-excel-file/node"
import Papa from "papaparse"

export const MAX_ROWS = 1000 // reject bigger files with a clear message (IMPORT.md §1)

// Flatten a parsed cell value to plain text. read-excel-file yields strings,
// numbers, booleans, Dates, or null.
function cellText(v: any): string {
  if (v == null) return ""
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v)
}

export type ParsedFile = { sheets: string[]; sheet: string; grid: string[][] }

// Parse one sheet (default: first) into a rectangular string grid.
export async function parseFile(buffer: Buffer, filename: string, sheet?: string): Promise<ParsedFile> {
  const isCsv = filename.toLowerCase().endsWith(".csv")
  if (isCsv) {
    const text = buffer.toString("utf-8")
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: false })
    const grid = (parsed.data as string[][]).map((r) => (Array.isArray(r) ? r.map((c) => (c ?? "").toString()) : []))
    return { sheets: ["CSV"], sheet: "CSV", grid }
  }

  // read-excel-file with getSheets:true returns [{ sheet, data }] (names + grids).
  const info: any[] = await (readXlsxFile as any)(buffer, { getSheets: true })
  const names: string[] = (info ?? []).map((s) => s.sheet ?? s.name).filter(Boolean)
  if (names.length === 0) return { sheets: [], sheet: "", grid: [] }
  const chosen = sheet && names.includes(sheet) ? sheet : names[0]

  // Prefer the grid returned alongside the name; fall back to a per-sheet read.
  const found = (info ?? []).find((s) => (s.sheet ?? s.name) === chosen)
  const data: any[][] = Array.isArray(found?.data)
    ? found.data
    : ((await (readXlsxFile as any)(buffer, { sheet: chosen })) as any[][])

  const grid = (data ?? []).map((r) => (Array.isArray(r) ? r.map(cellText) : []))
  return { sheets: names, sheet: chosen, grid }
}

// Rows below the header that actually carry data (any non-empty cell).
export function dataRows(grid: string[][], headerRow: number): string[][] {
  return grid.slice(headerRow + 1).filter((r) => r.some((c) => (c ?? "").trim() !== ""))
}

// Header-row detection (IMPORT.md §2): scan the first ~10 rows and pick the one
// that most looks like headers — many short-text cells, few long sentences, and
// followed by a similarly-filled row. Never assume row 1.
export function detectHeaderRow(grid: string[][]): number {
  const limit = Math.min(10, grid.length)
  let best = 0
  let bestScore = -Infinity
  for (let i = 0; i < limit; i++) {
    const row = grid[i] ?? []
    const nonEmpty = row.filter((c) => (c ?? "").trim() !== "").length
    if (nonEmpty === 0) continue
    const longCells = row.filter((c) => (c ?? "").trim().length > 40).length
    const shortCells = row.filter((c) => {
      const t = (c ?? "").trim()
      return t.length > 0 && t.length <= 40 && !/[.!?]\s/.test(t) // not a sentence
    }).length
    const next = grid[i + 1] ?? []
    const nextNonEmpty = next.filter((c) => (c ?? "").trim() !== "").length
    const followBonus = nextNonEmpty >= Math.max(1, nonEmpty - 1) ? 2 : 0
    const score = shortCells - longCells * 3 + followBonus
    if (score > bestScore) { bestScore = score; best = i }
  }
  return best
}
