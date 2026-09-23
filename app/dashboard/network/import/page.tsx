"use client"

// Network Tracker — CSV / XLSX import wizard (IMPORT.md, and for the coach-run
// path docs/network-tracker/coach-contacts-import.md). Upload → we guess →
// check → confirm → import. The file stays in browser state and is re-uploaded
// to commit, so no server-side session.
//
// A coach can run this on a client's board, so WHOSE BOARD IS THIS shows on
// every step and has to be confirmed by name before anything is written. The
// name comes from the server, for the subject it authorised, never from the
// URL: a page that displayed the id it was given would confirm nothing.

import { useCallback, useEffect, useRef, useState } from "react"
import { T, headline, eyebrow, card, select as selectStyle, selectOption } from "../../../../lib/dashboard-theme"
import { authFetch, getToken, subjectId, withSubject } from "../authFetch"
import { IMPORT_FIELDS, type ImportField } from "../../../../lib/network-tracker/import-fields"
import { resolveImportedName, displayName } from "../../../../lib/network-tracker/parse-name"

type Subject = { id: string; name: string | null; isCoachView: boolean }
type Disposition = "create" | "skip_duplicate_email" | "skip_duplicate_name" | "skip_conflict" | "skip_invalid"
type DryRow = {
  rowNum: number
  disposition: Disposition
  display: string
  company: string
  companyAction: "none" | "match_domain" | "match_name" | "create"
  emailDropped: boolean
  detail: string | null
}
type DryRun = {
  summary: Record<string, number>
  rows: DryRow[]
  companiesToCreate: { name: string; domain: string | null }[]
  domainBackfills: { name: string; domain: string | null }[]
}
type Preview = {
  subject: Subject
  sheets: string[]
  sheet: string
  headerRow: number
  headers: string[]
  sampleRows: string[][]
  guessedMapping: (ImportField | null)[]
  totalRows: number
  dryRun: DryRun | null
}
type PlanJob = {
  id: string
  status: string
  step: string
  drive_file_url: string | null
  shared_at: string | null
}
type Result = {
  subject: Subject
  imported: number
  summary: Record<string, number>
  companiesCreated: { name: string; domain: string | null }[]
  domainBackfills: { name: string; domain: string | null }[]
  skipped: { rowNum: number; display: string; disposition: Disposition; detail: string | null }[]
  insertFailures: { display: string; reason: string }[]
  defaultsApplied: string[]
}

const DISPOSITION_LABEL: Record<Disposition, string> = {
  create: "Will be created",
  skip_duplicate_email: "Skip — email already on the board",
  skip_duplicate_name: "Skip — same name at that company",
  skip_conflict: "Skip — domain and company name disagree",
  skip_invalid: "Skip — not enough to file it",
}

async function authForm(url: string, form: FormData) {
  const token = await getToken()
  // withSubject carries ?client_profile_id= so the write lands on the client's
  // board and not the coach's own.
  const res = await fetch(withSubject(url), { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form })
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
  const [confirmed, setConfirmed] = useState(false)
  // The Networking Plan is a second act on the SAME file, which the page still
  // holds, so the coach does not have to find the workbook again.
  const [plan, setPlan] = useState<PlanJob | null>(null)
  const [planBusy, setPlanBusy] = useState(false)
  const [planErr, setPlanErr] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const isCoachView = subjectId() !== null
  const subject = result?.subject ?? preview?.subject ?? null
  // The name from the server, for the board this page is pointed at. It arrives
  // with the first preview, but the banner has to say whose board this is
  // BEFORE a file is chosen, so it is also fetched on mount. Without that the
  // header reads "Importing into ..." at exactly the moment a coach is deciding
  // whether they are in the right place.
  const [rosterName, setRosterName] = useState<string | null>(null)
  const boardName = subject?.name ?? rosterName

  useEffect(() => {
    const id = subjectId()
    if (!id) return
    let alive = true
    void (async () => {
      try {
        const res = await authFetch("/api/coach/clients")
        const j = await res.json().catch(() => ({}))
        const hit = (j?.clients ?? []).find((c: any) => c.client_profile_id === id)
        if (alive && hit) setRosterName(hit.name ?? hit.email ?? null)
      } catch {
        // The preview will supply the name a moment later; a failed roster
        // lookup should not block the page.
      }
    })()
    return () => { alive = false }
  }, [])

  const runPreview = useCallback(
    async (f: File, opts: { sheet?: string; headerRow?: number; mapping?: (ImportField | null)[] } = {}) => {
      setBusy(true); setErr(null)
      try {
        const form = new FormData()
        form.append("file", f)
        if (opts.sheet) form.append("sheet", opts.sheet)
        if (opts.headerRow != null) form.append("headerRow", String(opts.headerRow))
        if (opts.mapping) form.append("mapping", JSON.stringify(opts.mapping))
        const { res, j } = await authForm("/api/network/import/preview", form)
        if (!res.ok || !j?.ok) throw new Error(j?.error || `Preview failed (${res.status})`)
        setPreview(j)
        if (!opts.mapping) setMapping(j.guessedMapping)
      } catch (e: any) {
        setErr(e?.message || String(e)); setPreview(null)
      } finally {
        setBusy(false)
      }
    },
    [],
  )

  function onPick(f: File | null) {
    setResult(null); setPreview(null); setErr(null); setConfirmed(false)
    setPlan(null); setPlanErr(null)
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
      if (preview.subject.name) form.append("confirmName", preview.subject.name)
      const { res, j } = await authForm("/api/network/import/commit", form)
      if (!res.ok || !j?.ok) throw new Error(j?.error || `Import failed (${res.status})`)
      setResult(j)
    } catch (e: any) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  async function createPlan() {
    if (!file) return
    setPlanBusy(true); setPlanErr(null)
    try {
      const form = new FormData()
      form.append("file", file)
      const { res, j } = await authForm("/api/network/plan/run", form)
      if (!res.ok || !j?.ok) throw new Error(j?.error || `Plan failed (${res.status})`)
      setPlan(j.job)
    } catch (e: any) {
      setPlanErr(e?.message || String(e))
    } finally {
      setPlanBusy(false)
    }
  }

  async function sharePlan() {
    if (!plan) return
    setPlanBusy(true); setPlanErr(null)
    try {
      const token = await getToken()
      const res = await fetch(withSubject(`/api/network/plan/${plan.id}/share`), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) throw new Error(j?.error || `Share failed (${res.status})`)
      setPlan({ ...plan, shared_at: j.shared_at })
    } catch (e: any) {
      setPlanErr(e?.message || String(e))
    } finally {
      setPlanBusy(false)
    }
  }

  const nameColIndex = mapping.indexOf("name")
  const showSplit = nameColIndex >= 0 && mapping.indexOf("first_name") < 0 && mapping.indexOf("last_name") < 0
  const dry = preview?.dryRun ?? null
  const canCommit = Boolean(dry) && (!isCoachView || confirmed) && !busy

  return (
    <main style={{ padding: "24px", maxWidth: 1100, margin: "0 auto" }}>
      <div style={eyebrow}>NETWORK TRACKER</div>
      <h1 style={{ ...headline, marginTop: 6 }}>Import contacts</h1>

      {/* Whose board. On every step, not just the confirm. */}
      {isCoachView && (
        <div style={{ ...card, marginTop: 12, padding: "12px 14px", borderColor: T.BORDER_SOFT, display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: 0.4, textTransform: "uppercase", color: T.DIM }}>Importing into</span>
          <span style={{ fontSize: 15, fontWeight: 900, color: T.TEXT }}>{boardName ?? "…"}</span>
          <span style={{ fontSize: 12, color: T.MUTED }}>their networking board, not yours</span>
        </div>
      )}

      <p style={{ color: T.MUTED, fontSize: 13, marginTop: 10 }}>
        Upload a CSV or Excel file. We&apos;ll guess the columns, show you exactly what would be created, and change nothing until you say so.
      </p>

      {/* file picker */}
      <div style={{ marginTop: 18, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <input ref={fileInput} type="file" accept=".csv,.xlsx" onChange={(e) => onPick(e.target.files?.[0] ?? null)} style={{ display: "none" }} />
        <button onClick={() => fileInput.current?.click()} style={primaryBtn}>
          {file ? "Choose a different file" : "Choose a file"}
        </button>
        {file && <span style={{ color: T.MUTED, fontSize: 13 }}>{file.name}</span>}
        {busy && <span style={{ color: T.DIM, fontSize: 12 }}>Working…</span>}
      </div>

      {err && <div style={{ ...card, marginTop: 16, padding: 14, background: T.ERROR_BG, borderColor: "rgba(255,120,120,0.35)", color: T.ERROR, fontSize: 13 }}>{err}</div>}

      {/* result */}
      {result && (
        <div style={{ ...card, marginTop: 18, padding: 20 }}>
          <div style={{ color: T.TEXT, fontSize: 16, fontWeight: 900 }}>
            Imported {result.imported} contact{result.imported === 1 ? "" : "s"}
            {result.subject.name ? ` into ${result.subject.name}'s board` : ""}.
          </div>
          <ul style={{ color: T.MUTED, fontSize: 13, marginTop: 10, lineHeight: "22px", paddingLeft: 18 }}>
            {result.companiesCreated.length > 0 && <li>Companies created: {result.companiesCreated.length} ({result.companiesCreated.slice(0, 6).map((c) => c.name).join(", ")}{result.companiesCreated.length > 6 ? "…" : ""})</li>}
            {result.domainBackfills.length > 0 && <li>Domains filled in on existing companies: {result.domainBackfills.map((b) => `${b.name} → ${b.domain}`).join(", ")}</li>}
            {result.skipped.length > 0 && <li>Skipped: {result.skipped.length}</li>}
            {result.insertFailures.length > 0 && <li style={{ color: T.WRN_ORANGE }}>Could not be written: {result.insertFailures.map((f) => `${f.display} (${f.reason})`).join("; ")}</li>}
            <li>Defaults applied: {result.defaultsApplied.join("; ")}</li>
          </ul>
          <a href={withSubject("/dashboard/network/contacts")} style={{ ...primaryBtn, display: "inline-block", marginTop: 14, textDecoration: "none" }}>
            See imported contacts →
          </a>

          {/* THE PLAN, offered only once the contacts are actually in. It reads
              the workbook's Outreach Messages tab, so it is the same file and
              the same act, one step later. */}
          {isCoachView && (
            <div style={{ marginTop: 20, paddingTop: 18, borderTop: `1px solid ${T.BORDER_SOFT}` }}>
              <div style={{ ...eyebrow, color: T.MUTED, marginBottom: 8 }}>Networking plan</div>

              {!plan && (
                <>
                  <p style={{ color: T.MUTED, fontSize: 13, margin: "0 0 12px" }}>
                    Build the branded plan PDF from this workbook&apos;s Outreach Messages tab, save it to{" "}
                    {boardName ?? "the client"}&apos;s Networking folder in Drive, and file it in their library.
                    It stays hidden until you share it.
                  </p>
                  <button onClick={createPlan} disabled={planBusy} style={{ ...primaryBtn, opacity: planBusy ? 0.6 : 1 }}>
                    {planBusy ? "Building the plan…" : "Create Networking Plan"}
                  </button>
                </>
              )}

              {plan && (
                <div>
                  <div style={{ color: T.TEXT, fontSize: 14, fontWeight: 800 }}>
                    {plan.shared_at ? "Shared with the client." : "Saved to Drive and filed in the library, hidden."}
                  </div>
                  <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
                    {plan.drive_file_url && (
                      <a href={plan.drive_file_url} target="_blank" rel="noreferrer" style={{ ...secondaryBtn, textDecoration: "none" }}>
                        Open the PDF ↗
                      </a>
                    )}
                    {!plan.shared_at ? (
                      <button onClick={sharePlan} disabled={planBusy} style={{ ...primaryBtn, opacity: planBusy ? 0.6 : 1 }}>
                        {planBusy ? "Sharing…" : "Share with client"}
                      </button>
                    ) : (
                      <span style={{ color: T.MUTED, fontSize: 13 }}>
                        {boardName ?? "The client"} can see it in their library now.
                      </span>
                    )}
                  </div>
                </div>
              )}

              {planErr && (
                <div style={{ ...card, marginTop: 12, padding: 12, background: T.ERROR_BG, borderColor: "rgba(255,120,120,0.35)", color: T.ERROR, fontSize: 13 }}>
                  {planErr}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* preview / mapping */}
      {preview && !result && (
        <div style={{ marginTop: 20 }}>
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
              <thead><tr>{["Source column", "Import as", "Samples"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {preview.headers.map((h, ci) => (
                  <tr key={ci} style={{ borderTop: `1px solid ${T.BORDER_SOFT}` }}>
                    <td style={{ ...td, fontWeight: 700 }}>{h || <span style={{ color: T.DIM }}>(column {ci + 1})</span>}</td>
                    <td style={td}>
                      <select
                        value={mapping[ci] ?? ""}
                        onChange={(e) => {
                          setMapping((m) => m.map((v, j) => (j === ci ? ((e.target.value || null) as ImportField | null) : v)))
                          setPreview((p) => (p ? { ...p, dryRun: null } : p)) // mapping changed, the dry run is stale
                          setConfirmed(false)
                        }}
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

          {/* dry run */}
          {!dry && (
            <div style={{ marginTop: 20, display: "flex", gap: 12, alignItems: "center" }}>
              <button onClick={() => file && runPreview(file, { sheet: preview.sheet, headerRow: preview.headerRow, mapping })} disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}>
                {busy ? "Checking…" : "Check this import"}
              </button>
              <span style={{ color: T.DIM, fontSize: 12 }}>Reads the board and shows what would happen. Writes nothing.</span>
            </div>
          )}

          {dry && (
            <>
              <div style={{ ...eyebrow, color: T.MUTED, marginTop: 24, marginBottom: 10 }}>What this import would do</div>
              <div style={{ ...card, padding: 16 }}>
                <div style={{ fontSize: 15, fontWeight: 900, color: T.TEXT }}>
                  {dry.summary.create} contact{dry.summary.create === 1 ? "" : "s"} created
                  {boardName ? ` on ${boardName}'s board` : ""}, {dry.summary.total - dry.summary.create} skipped.
                </div>
                <ul style={{ color: T.MUTED, fontSize: 13, marginTop: 10, lineHeight: "22px", paddingLeft: 18 }}>
                  <li>Companies: {dry.summary.companiesMatched} matched, {dry.summary.companiesCreated} created{dry.summary.domainsBackfilled ? `, ${dry.summary.domainsBackfilled} domain${dry.summary.domainsBackfilled === 1 ? "" : "s"} filled in` : ""}</li>
                  {dry.summary.skip_duplicate_email > 0 && <li>Already on the board by email: {dry.summary.skip_duplicate_email}</li>}
                  {dry.summary.skip_duplicate_name > 0 && <li>Already on the board by name: {dry.summary.skip_duplicate_name}</li>}
                  {dry.summary.skip_conflict > 0 && <li style={{ color: T.WRN_ORANGE }}>Domain and company name disagree: {dry.summary.skip_conflict}</li>}
                  {dry.summary.skip_invalid > 0 && <li>Not enough to file: {dry.summary.skip_invalid}</li>}
                  {dry.summary.emailDropped > 0 && <li>Created with the email left blank (the cell was not an address): {dry.summary.emailDropped}</li>}
                  <li>Every new contact gets relationship <strong>cold</strong>, stage <strong>identified</strong>, priority blank.</li>
                </ul>
                {dry.companiesToCreate.length > 0 && (
                  <div style={{ color: T.MUTED, fontSize: 12.5, marginTop: 8 }}>
                    New companies: {dry.companiesToCreate.map((c) => c.name + (c.domain ? ` (${c.domain})` : "")).join(", ")}
                  </div>
                )}
              </div>

              <div style={{ overflowX: "auto", border: `1px solid ${T.BORDER_SOFT}`, borderRadius: 12, marginTop: 12, maxHeight: 420, overflowY: "auto" }}>
                <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 720, fontSize: 12.5 }}>
                  <thead><tr>{["Row", "Name", "Company", "What happens", "Why"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {dry.rows.map((r) => (
                      <tr key={r.rowNum} style={{ borderTop: `1px solid ${T.BORDER_SOFT}` }}>
                        <td style={{ ...td, color: T.DIM }}>{r.rowNum}</td>
                        <td style={{ ...td, fontWeight: 700 }}>{r.display || <span style={{ color: T.DIM }}>—</span>}</td>
                        <td style={{ ...td, color: T.MUTED }}>{r.company || "—"}{r.companyAction === "create" ? " (new)" : ""}</td>
                        <td style={{ ...td, color: r.disposition === "create" ? T.TEXT : T.MUTED, whiteSpace: "nowrap" }}>{DISPOSITION_LABEL[r.disposition]}</td>
                        <td style={{ ...td, color: T.DIM }}>{r.detail ?? (r.emailDropped ? "Email cell was not an address." : "")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* confirm the client, then commit */}
              {isCoachView && (
                <div style={{ ...card, marginTop: 16, padding: 16, borderColor: T.BORDER_SOFT }}>
                  <div style={{ ...eyebrow, color: T.MUTED, marginBottom: 8 }}>Confirm the client</div>
                  <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
                    <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} style={{ marginTop: 3 }} />
                    <span style={{ fontSize: 13.5, color: T.TEXT }}>
                      These {dry.summary.create} contacts belong to <strong>{boardName ?? "this client"}</strong> and should be added to their networking board.
                    </span>
                  </label>
                </div>
              )}

              <div style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <button onClick={commit} disabled={!canCommit} style={{ ...primaryBtn, opacity: canCommit ? 1 : 0.5, cursor: canCommit ? "pointer" : "not-allowed" }}>
                  {busy ? "Importing…" : `Import ${dry.summary.create} contact${dry.summary.create === 1 ? "" : "s"}${boardName ? ` into ${boardName}'s board` : ""}`}
                </button>
                <span style={{ color: T.DIM, fontSize: 12 }}>Existing contacts are never overwritten.</span>
              </div>
            </>
          )}
        </div>
      )}
    </main>
  )
}

const primaryBtn: React.CSSProperties = {
  background: T.GRAD_PRIMARY, color: T.INK_ON_ACCENT, fontWeight: 900, fontSize: 13,
  border: "none", borderRadius: 12, padding: "11px 18px", cursor: "pointer",
}
const secondaryBtn: React.CSSProperties = {
  background: "transparent", color: T.TEXT, fontWeight: 800, fontSize: 13,
  border: `1px solid ${T.BORDER_SOFT}`, borderRadius: 12, padding: "10px 16px", cursor: "pointer",
}
const th: React.CSSProperties = {
  textAlign: "left", padding: "9px 12px", fontSize: 10, fontWeight: 900, letterSpacing: 0.4,
  textTransform: "uppercase", color: T.DIM, background: T.NAV_DEFAULT_BG, whiteSpace: "nowrap",
}
const td: React.CSSProperties = { padding: "8px 12px", color: T.TEXT, verticalAlign: "middle" }
