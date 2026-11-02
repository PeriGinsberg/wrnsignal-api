"use client"

// Criteria proposals: Monday's suggested edits to a client's match criteria
// (lib/match/weekly.ts), each with the Job Queue decisions behind it. Approve
// writes the client's criteria; that night's matching re-judges them. Approval
// happens here, never from the email: mail scanners follow links.

import { useEffect, useState } from "react"
import { T, btnPrimary, btnSecondary, card } from "../../../../../lib/dashboard-theme"
import { TYPE } from "../../../../../lib/theme/surfaces"
import { authFetch } from "../../_tasks/taskClient"

type Proposal = {
  id: string; client_profile_id: string; client: string; week_of: string
  field: string; op: string; value: string; rationale: string; current: unknown
  evidence: { title: string; company: string; action: string; reason: string | null; note: string | null; score: number | null }[]
}

const FIELD: Record<string, string> = {
  target_roles: "Target roles", target_industries: "Target industries", excluded_industries: "Excluded industries",
  excluded_title_keywords: "Excluded title words", excluded_employers: "Excluded employers", max_years_required: "Max years asked",
  salary_floor: "Salary floor", notes: "Notes for the scorer",
}
const show = (v: unknown) => (Array.isArray(v) ? (v.length ? v.join(", ") : "none") : v === null || v === undefined || v === "" ? "none" : String(v))

export default function ProposalsPage() {
  const [items, setItems] = useState<Proposal[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState<Record<string, string>>({})

  useEffect(() => {
    authFetch("/api/coach/job-queue/proposals").then(async (r) => {
      const j = await r.json().catch(() => null)
      if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`)
      setItems(j.proposals)
    }).catch((e) => setError(String(e?.message || e)))
  }, [])

  const decide = async (p: Proposal, decision: "approve" | "reject") => {
    setBusy(p.id)
    try {
      const r = await authFetch("/api/coach/job-queue/proposals", { method: "PATCH", body: JSON.stringify({ id: p.id, decision }) })
      const j = await r.json().catch(() => null)
      if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`)
      setDone((d) => ({ ...d, [p.id]: decision === "approve" ? "Approved: criteria updated, re-judged tonight" : "Rejected" }))
    } catch (e: any) {
      setDone((d) => ({ ...d, [p.id]: `Failed: ${e.message}` }))
    }
    setBusy(null)
  }

  return (
    <div style={{ padding: "24px max(16px, env(safe-area-inset-right, 0px)) 48px max(16px, env(safe-area-inset-left, 0px))", maxWidth: 1000, margin: "0 auto", color: T.TEXT, display: "flex", flexDirection: "column", gap: 16 }}>
      <a href="/dashboard/coach/job-queue" style={{ color: T.INK_LINK, fontSize: TYPE.secondary }}>← Job Queue</a>
      <div>
        <h1 style={{ fontSize: TYPE.title, fontWeight: 900, margin: 0 }}>Criteria proposals</h1>
        <p style={{ margin: "4px 0 0", color: T.MUTED, maxWidth: "70ch" }}>Each Monday, a client with 5 or more Job Queue decisions the week before gets up to 3 suggested edits, each naming the decisions behind it. Approving one changes the client's criteria; that night's matching re-scores their queue.</p>
      </div>
      {error && <div style={{ ...card, padding: 16, color: T.ERROR, background: T.ERROR_BG }}>{error}</div>}
      {!items && !error && <div style={{ color: T.MUTED }}>Loading…</div>}
      {items && items.length === 0 && <div style={{ ...card, padding: 24, color: T.MUTED }}>No proposals waiting. They arrive Monday mornings once clients have decisions from the week before.</div>}
      {items?.map((p) => (
        <div key={p.id} style={{ ...card, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
            <b style={{ fontSize: TYPE.body }}>{p.client}</b>
            <span style={{ color: T.MUTED, fontSize: TYPE.secondary }}>week of {p.week_of}</span>
          </div>
          <div style={{ fontSize: TYPE.body }}>
            <b>{FIELD[p.field] ?? p.field}</b>: {p.op === "add" ? "add" : p.op === "remove" ? "remove" : "set to"} <b style={{ color: T.INK_EMPHASIS }}>{p.value}</b>
          </div>
          <div style={{ color: T.MUTED, fontSize: TYPE.secondary }}>Now: {show(p.current)}</div>
          <p style={{ margin: 0 }}>{p.rationale}</p>
          {p.evidence.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 18, color: T.MUTED, fontSize: TYPE.secondary, display: "flex", flexDirection: "column", gap: 2 }}>
              {p.evidence.map((e, i) => (
                <li key={i}>{e.action === "push" ? "Fit" : `Not a fit${e.reason ? ` (${e.reason.replace(/_/g, " ")}${e.note ? `; ${e.note}` : ""})` : ""}`}: {e.title} · {e.company}{e.score !== null ? ` · score ${e.score}` : ""}</li>
              ))}
            </ul>
          )}
          {done[p.id] ? (
            <div style={{ color: done[p.id].startsWith("Failed") ? T.ERROR : T.SUCCESS, fontWeight: 800 }}>{done[p.id]}</div>
          ) : (
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" disabled={busy === p.id} style={{ ...btnPrimary, minHeight: 34, padding: "0 14px", fontSize: 14 }} onClick={() => decide(p, "approve")}>Approve</button>
              <button type="button" disabled={busy === p.id} style={{ ...btnSecondary, minHeight: 34, padding: "0 14px", fontSize: 14 }} onClick={() => decide(p, "reject")}>Reject</button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
