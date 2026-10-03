"use client"

// LinkCompanyControl — on a coach's view of one client job: which company on
// the client's networking board this job belongs to, and a way to link,
// change or unlink it.
//
// A contact reaches a job through their company (the design in
// 20260805_application_company_link.sql), so linking the job's company is also
// how a coach ties a job to the client's contacts there.
//
// Reads:   GET  /api/network/companies?client_profile_id=[clientId]
// Writes:  POST /api/network/companies/link-application?client_profile_id=[clientId]
//            { application_id, company_id }      link to a board company
//            { application_id, company_name }    add to the board and link
//            { application_id, company_id: null } unlink
// Both routes resolve the client through lib/collab/scope.ts; linking needs
// FULL access and a coach with less gets the server's 403, shown here.

import { useState } from "react"
import { TYPE } from "../../../../../lib/theme/surfaces"
import { T, btnPrimary, btnSecondary } from "../../../../../lib/dashboard-theme"

type Company = { id: string; name: string }

export function LinkCompanyControl({ clientProfileId, applicationId, jobCompanyName, linked, authFetch, onChanged }: {
  clientProfileId: string
  applicationId: string
  /** The company name on the job itself, offered as "add to board". */
  jobCompanyName: string | null
  linked: Company | null
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>
  onChanged: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [companies, setCompanies] = useState<Company[] | null>(null)
  const [choice, setChoice] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const subject = `client_profile_id=${encodeURIComponent(clientProfileId)}`
  const jobName = (jobCompanyName || "").trim()

  async function startEditing() {
    setEditing(true); setError(null); setChoice("")
    if (companies) return
    try {
      const res = await authFetch(`/api/network/companies?${subject}`)
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) { setError(j?.error || `Couldn't load the board (${res.status})`); return }
      setCompanies((j.companies ?? []).map((c: any) => ({ id: String(c.id), name: String(c.name) })))
    } catch {
      setError("Network error — try again")
    }
  }

  async function send(payload: Record<string, unknown>) {
    setBusy(true); setError(null)
    try {
      const res = await authFetch(`/api/network/companies/link-application?${subject}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ application_id: applicationId, ...payload }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) { setError(j?.error || `Couldn't save (${res.status})`); return }
      setEditing(false)
      onChanged()
    } catch {
      setError("Network error — try again")
    } finally {
      setBusy(false)
    }
  }

  function save() {
    if (!choice) { setError("Pick a company first."); return }
    if (choice === "__new__") void send({ company_name: jobName })
    else void send({ company_id: choice })
  }

  const alreadyOnBoard = !!companies?.some((c) => c.name.trim().toLowerCase() === jobName.toLowerCase())
  const small: React.CSSProperties = { padding: "6px 12px", fontSize: TYPE.secondary }

  return (
    <div data-testid="link-company" style={{ fontSize: TYPE.secondary, color: T.DIM }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ color: T.MUTED, fontWeight: 700 }}>Networking company: </span>
        <span style={{ color: linked ? T.TEXT : T.DIM }}>{linked ? linked.name : "Not linked"}</span>
        {!editing && (
          <button type="button" onClick={() => void startEditing()} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: TYPE.secondary, fontWeight: 700, color: T.INK_LINK, textDecoration: "underline" }}>
            {linked ? "Change" : "Link to company"}
          </button>
        )}
        {!editing && linked && (
          <button type="button" disabled={busy} onClick={() => void send({ company_id: null })} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: TYPE.secondary, fontWeight: 700, color: T.MUTED, textDecoration: "underline" }}>
            Unlink
          </button>
        )}
      </div>
      {editing && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <select
            aria-label="Company on the client's board"
            value={choice}
            disabled={busy || !companies}
            onChange={(e) => setChoice(e.target.value)}
            style={{ fontSize: TYPE.secondary, padding: "6px 8px", borderRadius: 8, border: `1px solid ${T.BORDER_SOFT}`, background: T.CARD, color: T.TEXT, minWidth: 200 }}
          >
            <option value="">{companies ? "Choose a company" : "Loading…"}</option>
            {jobName && !alreadyOnBoard && <option value="__new__">Add “{jobName}” to the board</option>}
            {(companies ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button type="button" onClick={save} disabled={busy} style={{ ...btnPrimary, ...small, opacity: busy ? 0.6 : 1 }}>{busy ? "Saving…" : "Link"}</button>
          <button type="button" onClick={() => { setEditing(false); setError(null) }} disabled={busy} style={{ ...btnSecondary, ...small }}>Cancel</button>
        </div>
      )}
      {error && <div role="alert" style={{ fontSize: TYPE.micro, color: T.ERROR, marginTop: 6 }}>{error}</div>}
    </div>
  )
}
