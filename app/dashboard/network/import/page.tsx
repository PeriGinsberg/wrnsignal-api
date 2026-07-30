"use client"

// Network Tracker — CSV / XLSX import wizard (IMPORT.md). Upload → we guess →
// preview → confirm. The file stays in browser state and is re-uploaded to
// commit, so no server-side session. Parsing/mapping guesses come from the
// preview route; the name-split preview is computed client-side from the shared
// parse-name lib so it matches exactly what commit will write.

import { useCallback, useRef, useState } from "react"
import { T, headline, eyebrow, card, select as selectStyle, selectOption } from "../../../../lib/dashboard-theme"
import { getToken } from "../authFetch"
import { IMPORT_FIELDS, type ImportField } from "../../../../lib/network-tracker/import-fields"
import { resolveImportedName, displayName } from "../../../../lib/network-tracker/parse-name"

type Preview = {
  sheets: string[]
  sheet: string
  headerRow: number
  headers: string[]
  sampleRows: string[][]
  guessedMapping: (ImportField | null)[]
  totalRows: number
}
type Result = {
  imported: number
  companies: number
  newCompanies: number
  skippedDuplicates: string[]
  skippedNoName: number[]
  flagged: { nonPersonNames: number; unparseableEmails: number }
  leftBlankByDesign: string[]
}

async function authForm(url: string, form: FormData) {
  const token = await getToken()
  const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form })
  const j = await res.json().catch(() => ({}))
  return { res, j }
}

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [mapping, setMapping] = useState<(ImportField | null)[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const runPreview = useCallback(async (f: File, opts: { sheet?: string; headerRow?: number } = {}) => {
    setBusy(true); setErr(null)
    try {
      const form = new FormData()
      form.append("file", f)
      if (opts.sheet) form.append("sheet", opts.sheet)
      if (opts.headerRow != null) form.append("headerRow", String(opts.headerRow))
      const { res, j } = await authForm("/api/network/import/preview", form)
      if (!res.ok || !j?.ok) throw new Error(j?.error || `Preview failed (${res.status})`)
      setPreview(j)
      setMapping(j.guessedMapping)
    } catch (e: any) {
      setErr(e?.message || String(e)); setPreview(null)
    } finally {
      setBusy(false)
    }
  }, [])

  function onPick(f: File | null) {
    setResult(null); setPreview(null); setErr(null)
    setFile(f)
    if (f) void runPreview(f)
  }

  async function commit() {
    if (!file || !preview) return
    setBusy(true); setErr(null)
    try {
      const form = new FormData()
      form.append("file", file)
      form.append("sheet", preview.sheet)
      form.append("headerRow", String(preview.headerRow))
      form.append("mapping", JSON.stringify(mapping))
      const { res, j } = await authForm("/api/network/import/commit", form)
      if (!res.ok || !j?.ok) throw new Error(j?.error || `Import failed (${res.status})`)
      setResult(j)
    } catch (e: any) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  // Which source column feeds the name (for the split preview).
  const nameColIndex = mapping.indexOf("name")
  const showSplit = nameColIndex >= 0 && mapping.indexOf("first_name") < 0 && mapping.indexOf("last_name") < 0

  return (
    <main style={{ padding: "24px", maxWidth: 1100, margin: "0 auto" }}>
      <div style={eyebrow}>NETWORK TRACKER</div>
      <h1 style={{ ...headline, marginTop: 6 }}>Import contacts</h1>
      <p style={{ color: T.MUTED, fontSize: 13, marginTop: 6 }}>
        Upload a CSV or Excel file — we&apos;ll guess the columns and let you fix them before anything is saved.
      </p>

      {/* file picker */}
      <div style={{ marginTop: 18, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,.xlsx"
          onChange={(e) => onPick(e.target.files?.[0] ?? null)}
          style={{ display: "none" }}
        />
        <button onClick={() => fileInput.current?.click()} style={primaryBtn}>
          {file ? "Choose a different file" : "Choose a file"}
        </button>
        {file && <span style={{ color: T.MUTED, fontSize: 13 }}>{file.name}</span>}
        {busy && <span style={{ color: T.DIM, fontSize: 12 }}>Working…</span>}
      </div>

      {err && <div style={{ ...card, marginTop: 16, padding: 14, background: T.ERROR_BG, borderColor: "rgba(255,120,120,0.35)", color: T.ERROR, fontSize: 13 }}>{err}</div>}

      {/* result summary */}
      {result && (
        <div style={{ ...card, marginTop: 18, padding: 20 }}>
          <div style={{ color: T.TEXT, fontSize: 16, fontWeight: 900 }}>
            Imported {result.imported} contact{result.imported === 1 ? "" : "s"} across {result.companies} compan{result.companies === 1 ? "y" : "ies"}
            {result.newCompanies > 0 ? ` (${result.newCompanies} new)` : ""}.
          </div>
          <ul style={{ color: T.MUTED, fontSize: 13, marginTop: 10, lineHeight: "22px", paddingLeft: 18 }}>
            {result.skippedDuplicates.length > 0 && <li>Skipped as duplicates: {result.skippedDuplicates.length} — {result.skippedDuplicates.slice(0, 8).join(", ")}{result.skippedDuplicates.length > 8 ? "…" : ""}</li>}
            {result.skippedNoName.length > 0 && <li>Skipped for no name: {result.skippedNoName.length} (rows {result.skippedNoName.slice(0, 12).join(", ")}{result.skippedNoName.length > 12 ? "…" : ""})</li>}
            {result.flagged.nonPersonNames > 0 && <li>Flagged but imported — non-person names: {result.flagged.nonPersonNames}</li>}
            {result.flagged.unparseableEmails > 0 && <li>Flagged but imported — contact-method text kept as a note: {result.flagged.unparseableEmails}</li>}
            <li>Left blank by design: {result.leftBlankByDesign.join("; ")}</li>
          </ul>
          <a href="/dashboard/network/contacts" style={{ ...primaryBtn, display: "inline-block", marginTop: 14, textDecoration: "none" }}>
            See imported contacts →
          </a>
        </div>
      )}

      {/* preview / mapping */}
      {preview && !result && (
        <div style={{ marginTop: 20 }}>
          {/* sheet + header row controls */}
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
            {preview.sheets.length > 1 && (
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: T.MUTED }}>
                Sheet
                <select value={preview.sheet} onChange={(e) => file && runPreview(file, { sheet: e.target.value })} style={{ ...selectStyle, width: "auto", height: 34 }}>
                  {preview.sheets.map((s) => <option key={s} value={s} style={selectOption}>{s}</option>)}
                </select>
              </label>
            )}
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: T.MUTED }}>
              Header row
              <select
                value={preview.headerRow}
                onChange={(e) => file && runPreview(file, { sheet: preview.sheet, headerRow: Number(e.target.value) })}
                style={{ ...selectStyle, width: "auto", height: 34 }}
              >
                {Array.from({ length: Math.min(10, preview.headerRow + preview.sampleRows.length + 1) }, (_, i) => (
                  <option key={i} value={i} style={selectOption}>Row {i + 1}</option>
                ))}
              </select>
            </label>
            <span style={{ color: T.DIM, fontSize: 12 }}>{preview.totalRows} data rows</span>
          </div>

          {/* column mapping */}
          <div style={{ ...eyebrow, color: T.MUTED, marginTop: 20, marginBottom: 10 }}>Map columns</div>
          <div style={{ overflowX: "auto", border: `1px solid ${T.BORDER_SOFT}`, borderRadius: 12 }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 720, fontSize: 12.5 }}>
              <thead>
                <tr>{["Source column", "Import as", "Samples"].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {preview.headers.map((h, ci) => (
                  <tr key={ci} style={{ borderTop: `1px solid ${T.BORDER_SOFT}` }}>
                    <td style={{ ...td, fontWeight: 700 }}>{h || <span style={{ color: T.DIM }}>(column {ci + 1})</span>}</td>
                    <td style={td}>
                      <select
                        value={mapping[ci] ?? ""}
                        onChange={(e) => setMapping((m) => m.map((v, j) => (j === ci ? (e.target.value || null) as ImportField | null : v)))}
                        style={{ ...selectStyle, height: 32, fontSize: 12, width: 190 }}
                      >
                        <option value="" style={selectOption}>Don&apos;t import</option>
                        {IMPORT_FIELDS.map((f) => <option key={f.field} value={f.field} style={selectOption}>{f.label}</option>)}
                      </select>
                    </td>
                    <td style={{ ...td, color: T.MUTED }}>
                      {preview.sampleRows.slice(0, 3).map((r) => (r[ci] ?? "").toString().trim()).filter(Boolean).slice(0, 3).join(" · ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* name-split preview */}
          {showSplit && (
            <>
              <div style={{ ...eyebrow, color: T.MUTED, marginTop: 20, marginBottom: 10 }}>Name split (first 10)</div>
              <div style={{ overflowX: "auto", border: `1px solid ${T.BORDER_SOFT}`, borderRadius: 12 }}>
                <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 520, fontSize: 12.5 }}>
                  <thead><tr>{["Source name", "First", "Last", ""].map((h, i) => <th key={i} style={th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {preview.sampleRows.map((r, ri) => {
                      const raw = (r[nameColIndex] ?? "").toString()
                      const s = resolveImportedName(raw)
                      return (
                        <tr key={ri} style={{ borderTop: `1px solid ${T.BORDER_SOFT}` }}>
                          <td style={td}>{raw || "—"}</td>
                          <td style={{ ...td, color: T.MUTED }}>{s.first_name || <span style={{ color: T.DIM }}>—</span>}</td>
                          <td style={td}>{s.last_name || "—"}</td>
                          <td style={td}>{s.nonPerson && <span style={{ color: T.WRN_ORANGE, fontSize: 10, fontWeight: 800 }}>not a person?</span>}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <div style={{ marginTop: 20, display: "flex", gap: 12, alignItems: "center" }}>
            <button onClick={commit} disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}>
              {busy ? "Importing…" : `Import ${preview.totalRows} contacts`}
            </button>
            <span style={{ color: T.DIM, fontSize: 12 }}>Existing contacts are never overwritten.</span>
          </div>
        </div>
      )}
    </main>
  )
}

const primaryBtn: React.CSSProperties = {
  background: T.GRAD_PRIMARY, color: T.INK_ON_ACCENT, fontWeight: 900, fontSize: 13,
  border: "none", borderRadius: 12, padding: "11px 18px", cursor: "pointer",
}
const th: React.CSSProperties = {
  textAlign: "left", padding: "9px 12px", fontSize: 10, fontWeight: 900, letterSpacing: 0.4,
  textTransform: "uppercase", color: T.DIM, background: T.NAV_DEFAULT_BG, whiteSpace: "nowrap",
}
const td: React.CSSProperties = { padding: "8px 12px", color: T.TEXT, verticalAlign: "middle" }
