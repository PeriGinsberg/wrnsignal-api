"use client"

// One job in the Job Queue: the posting's facts, a chip per client (best score
// across the job's copies), and the panels a chip or the row opens: the
// client's match (Add Job / Not a fit), every client, every listing.
//
// Every write goes through the page's callbacks, which call the API and then
// update the page's copy of the queue: a row never holds state the page lost.

import { useState } from "react"
import { T, btnPrimary, btnSecondary, input } from "../../../../lib/dashboard-theme"
import { TYPE } from "../../../../lib/theme/surfaces"
import type { QChip, QClient, QJob, QReason } from "./types"

export const CHIP_FLOOR = 50
const KIND: Record<string, string> = { employer: "Employer site", board: "Job board", republisher: "Republisher", other: "Other site", google: "Google listing" }
const STATUS_LABEL = { evaluating: "Evaluating", fit: "Fit", not_fit: "Not a fit" } as const
const FLAG_LABEL = { closed: "Closed", bad_link: "Bad link", not_us: "Not in the US" } as const

const small: React.CSSProperties = { ...btnSecondary, minHeight: 32, padding: "0 12px", fontSize: 13, borderRadius: 10 }
const ghost: React.CSSProperties = { ...small, background: "transparent", border: `1px solid transparent`, color: T.INK_LINK }

export function band(s?: number) {
  if (s === undefined) return { bg: T.GLASS, border: T.BORDER_SOFT, ink: T.MUTED }
  if (s >= 70) return { bg: T.SUCCESS_BG, border: T.SUCCESS_BORDER, ink: T.SUCCESS }
  if (s >= 50) return { bg: T.BLUE_BG, border: T.BLUE_BORDER, ink: T.WRN_BLUE }
  return { bg: T.GLASS, border: T.BORDER_SOFT, ink: T.MUTED }
}
const statusColor = (s?: QChip["status"]) =>
  s === "fit" ? T.SUCCESS : s === "not_fit" ? T.ERROR : s === "evaluating" ? T.WRN_ORANGE : T.MUTED

function pay(j: QJob) {
  if (j.sl === undefined && j.sh === undefined) return null
  const f = (n?: number) => (n === undefined ? "?" : j.sp === "year" && n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${n}`)
  const per = ({ year: "/yr", hour: "/hr", month: "/mo", week: "/wk" } as Record<string, string>)[j.sp ?? ""] ?? ""
  return (j.sl === j.sh || j.sh === undefined ? f(j.sl) : `${f(j.sl)}–${f(j.sh)}`) + per
}
function years(j: QJob) {
  if (j.ymin === undefined && j.ymax === undefined) return null
  if ((j.ymin ?? 0) === 0 && !j.ymax) return "0 yrs"
  return `${j.ymin ?? 0}${j.ymax && j.ymax !== j.ymin ? `–${j.ymax}` : "+"} yrs${j.yb === "preferred" ? " (pref.)" : ""}`
}
export function ago(iso?: string) {
  if (!iso) return "?"
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5)
  return d <= 0 ? "today" : d === 1 ? "1 day ago" : `${d} days ago`
}

type Props = {
  job: QJob
  clients: QClient[]
  reasons: QReason[]
  /** The chips to show (filtered by the page), and how many are under the floor. */
  visible: QChip[]
  under: number
  showingUnder: boolean
  isNew: (m: QChip) => boolean
  onToggleUnder: () => void
  onAddJob: (job: QJob, m: QChip) => void
  onNotFit: (job: QJob, m: QChip, reason: string, note: string) => Promise<boolean>
  onUndo: (job: QJob, m: QChip) => void
  onFlag: (job: QJob, flag: QJob["flag"] | null) => void
  onSaveUrl: (job: QJob, url: string) => Promise<boolean>
  loadDetails: (job: QJob) => Promise<{ requirements_summary?: string } | null>
}

export function JobQueueRow(p: Props) {
  const { job: j, clients } = p
  const [chipOpen, setChipOpen] = useState<number | null>(null)
  const [allOpen, setAllOpen] = useState(false)
  const [listsOpen, setListsOpen] = useState(false)
  const [details, setDetails] = useState<{ requirements_summary?: string } | null | "loading">(null)

  const openChip = chipOpen === null ? null : j.m.find((m) => m.c === chipOpen) ?? null
  const pp = pay(j), y = years(j)
  const flags: React.ReactNode[] = []
  const flag = (label: string, tone: "new" | "good" | "bad" | "plain" = "plain", title?: string) => {
    const c = tone === "new" ? T.WRN_ORANGE : tone === "good" ? T.SUCCESS : tone === "bad" ? T.ERROR : T.MUTED
    flags.push(<span key={label} title={title} style={{ fontSize: TYPE.micro, fontWeight: 800, color: c, border: `1px solid ${T.BORDER_SOFT}`, borderRadius: 999, padding: "2px 8px" }}>{label}</span>)
  }
  if (p.visible.some(p.isNew)) flag("New", "new")
  if (j.campus) flag("Campus", "good")
  if (j.closed) flag("Likely closed", "bad", "The link check found every link dead (404/410)")
  if (j.badLink) flag("Bad link", "bad", "A coach marked the link wrong. Save a working link to clear it.")
  if (j.rep) flag("Republished link", "plain", "Only a republisher or other site carries this job")
  if (!j.lcs) flag("Link not checked")
  if (j.dl) flag(`Deadline ${j.dl.slice(0, 10)}`)
  if (j.tier && j.tier !== "now or not stated") flag(j.tier)

  const toggleAll = async () => {
    const next = !allOpen
    setAllOpen(next)
    if (next && details === null) {
      setDetails("loading")
      setDetails(await p.loadDetails(j))
    }
  }

  return (
    <article style={{ border: `1px solid ${j.flag ? T.ERROR_BORDER : T.BORDER_SOFT}`, background: T.CARD, borderRadius: 14, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8, opacity: j.flag ? 0.7 : 1 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: "1 1 360px" }}>
          <div style={{ fontSize: TYPE.body, fontWeight: 900 }}>
            {j.url ? <a href={j.url} target="_blank" rel="noopener noreferrer" style={{ color: T.TEXT, textDecoration: "none" }}>{j.t} <span style={{ color: T.INK_LINK, fontSize: 13 }}>↗</span></a> : j.t}
          </div>
          <div style={{ fontSize: TYPE.secondary, color: T.MUTED }}>
            {j.co} · {j.loc || "Location not stated"}
            {j.ls && <> · <button type="button" onClick={() => setListsOpen(!listsOpen)} aria-expanded={listsOpen} style={{ ...ghost, minHeight: 0, padding: 0, fontSize: TYPE.secondary }}>{j.ls.length} listings</button></>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {j.flag ? (
            <button type="button" style={small} onClick={() => p.onFlag(j, null)}>Undo “{FLAG_LABEL[j.flag]}”</button>
          ) : (
            (["closed", "bad_link", "not_us"] as const).map((f) => (
              <button key={f} type="button" style={small} title="Applies to every client and every listing of this job" onClick={() => p.onFlag(j, f)}>{FLAG_LABEL[f]}</button>
            ))
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: TYPE.secondary, color: T.MUTED }}>
        <span>Pay <b style={{ color: pp ? T.TEXT : T.DIM }}>{pp ?? "not listed"}</b></span>
        <span>Experience <b style={{ color: y ? T.TEXT : T.DIM }}>{y ?? "not stated"}</b></span>
        <span>Start <b style={{ color: T.TEXT }}>{(j.st ?? "").replace(/^starts /, "").replace("start not stated", "not stated") || "not stated"}</b></span>
        <span>Found <b style={{ color: T.TEXT }}>{ago(j.seen)}</b></span>
      </div>
      {flags.length > 0 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{flags}</div>}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {p.visible.map((m) => {
          const b = band(m.s)
          const on = chipOpen === m.c
          return (
            <button key={m.c} type="button" aria-expanded={on} onClick={() => setChipOpen(on ? null : m.c)}
              title={m.all ? `Best of ${m.all.length} listings: ${m.all.map((x) => x ?? "–").join(", ")}` : m.why}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, minHeight: 32, padding: "0 4px 0 10px", borderRadius: 999, cursor: "pointer",
                background: on ? T.BLUE_BG_ON : b.bg, border: `1px solid ${on ? T.BLUE_BORDER_ON : b.border}`, color: T.TEXT, fontSize: 13, fontWeight: 800 }}>
              {clients[m.c]?.first}
              <span style={{ background: T.NAV_BG, color: b.ink, borderRadius: 999, padding: "2px 8px", fontWeight: 900 }}>{m.s ?? "–"}</span>
              {m.status && <span style={{ color: statusColor(m.status), fontSize: TYPE.micro, fontWeight: 900, paddingRight: 6 }}>{STATUS_LABEL[m.status]}</span>}
            </button>
          )
        })}
        {(p.under > 0 || p.showingUnder) && (
          <button type="button" style={{ ...ghost, fontSize: 12 }} onClick={p.onToggleUnder}>{p.showingUnder ? `Hide under ${CHIP_FLOOR}` : `+${p.under} under ${CHIP_FLOOR}`}</button>
        )}
        <button type="button" style={{ ...ghost, fontSize: 12, marginLeft: "auto" }} aria-expanded={allOpen} onClick={toggleAll}>
          {allOpen ? "Collapse" : `All ${j.m.length} client${j.m.length > 1 ? "s" : ""}`}
        </button>
      </div>

      {(openChip || allOpen || listsOpen) && (
        <div style={{ borderTop: `1px solid ${T.BORDER_SOFT}`, paddingTop: 10, display: "flex", flexDirection: "column", gap: 12 }}>
          {listsOpen && j.ls && <Listings job={j} onSaveUrl={p.onSaveUrl} />}
          {openChip && (
            <ClientMatchPanel job={j} m={openChip} client={clients[openChip.c]} reasons={p.reasons} isNew={p.isNew(openChip)}
              onAddJob={() => p.onAddJob(j, openChip)} onUndo={() => p.onUndo(j, openChip)}
              onNotFit={async (r, n) => { const ok = await p.onNotFit(j, openChip, r, n); if (ok) setChipOpen(null); return ok }} />
          )}
          {allOpen && (
            <>
              {details === "loading" && <div style={{ color: T.MUTED, fontSize: TYPE.secondary }}>Loading requirements…</div>}
              {details && details !== "loading" && details.requirements_summary && (
                <div style={{ fontSize: TYPE.secondary, color: T.MUTED, maxWidth: "80ch" }}><b style={{ color: T.TEXT }}>Requirements:</b> {details.requirements_summary}</div>
              )}
              {!j.ls && <SaveUrl job={j} onSaveUrl={p.onSaveUrl} />}
              <AllClients job={j} clients={clients} isNew={p.isNew} onOpen={(c) => setChipOpen(c)} />
            </>
          )}
        </div>
      )}
    </article>
  )
}

function ClientMatchPanel(p: { job: QJob; m: QChip; client?: QClient; reasons: QReason[]; isNew: boolean; onAddJob: () => void; onUndo: () => void; onNotFit: (reason: string, note: string) => Promise<boolean> }) {
  const { m } = p
  const [picking, setPicking] = useState(false)
  const b = band(m.s)
  return (
    <div style={{ background: T.GLASS, border: `1px solid ${T.BORDER_SOFT}`, borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <b style={{ fontSize: TYPE.body }}>{p.client?.name}</b>
        <span style={{ color: b.ink, fontWeight: 900 }}>score {m.s ?? "–"}</span>
        {m.rk !== undefined && <span style={{ color: T.MUTED, fontSize: TYPE.secondary }}>rank {m.rk} of {p.client?.queueSize ?? "?"} in their queue{p.isNew ? " · new" : ""}</span>}
        {m.status && <span style={{ color: statusColor(m.status), fontWeight: 900, fontSize: TYPE.secondary }}>{STATUS_LABEL[m.status]}{m.reason ? `: ${p.reasons.find((r) => r.value === m.reason)?.label ?? m.reason}` : ""}{m.note ? ` · ${m.note}` : ""}</span>}
      </div>
      {m.why && <p style={{ margin: 0, maxWidth: "80ch" }}>{m.why}</p>}
      {m.all && <p style={{ margin: 0, color: T.MUTED, fontSize: TYPE.secondary }}>Best score across {m.all.length} listings of this job ({m.all.map((x) => x ?? "–").join(", ")}). The reason is from the best one.</p>}
      {m.jobfitScore !== undefined && <p style={{ margin: 0, color: T.MUTED, fontSize: TYPE.secondary }}>JobFit {m.jobfitScore}{m.jobfitDecision ? ` · ${m.jobfitDecision}` : ""}</p>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" style={{ ...btnPrimary, minHeight: 34, padding: "0 14px", fontSize: 14 }} onClick={p.onAddJob} title="Opens Source a Job for this client in a new tab, prefilled. Marks the job Evaluating.">Add Job</button>
        <button type="button" style={small} onClick={() => setPicking(!picking)} aria-expanded={picking}>Not a fit</button>
        {/* A Fit put the job in the client's tracker; that is undone there, not here. */}
        {m.status && m.status !== "fit" && <button type="button" style={ghost} onClick={p.onUndo}>Undo</button>}
      </div>
      {picking && <NotAFitPicker reasons={p.reasons} onCancel={() => setPicking(false)} onSave={p.onNotFit} copies={m.ids.length} />}
    </div>
  )
}

export function NotAFitPicker(p: { reasons: QReason[]; copies: number; onCancel: () => void; onSave: (reason: string, note: string) => Promise<boolean> }) {
  const [reason, setReason] = useState<string | null>(null)
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const needsNote = !!p.reasons.find((r) => r.value === reason)?.requiresNote
  const can = !!reason && (!needsNote || note.trim().length > 0) && !busy
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }} role="group" aria-label="Why it's not a fit">
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {p.reasons.map((r) => (
          <button key={r.value} type="button" onClick={() => setReason(r.value)} aria-pressed={reason === r.value}
            style={{ ...small, background: reason === r.value ? T.BLUE_BG_ON : T.NAV_DEFAULT_BG, borderColor: reason === r.value ? T.BLUE_BORDER_ON : T.BORDER_SOFT }}>
            {r.label.replace(" (note required)", "")}
          </button>
        ))}
      </div>
      <input style={{ ...input, maxWidth: 560 }} value={note} onChange={(e) => setNote(e.target.value)}
        placeholder={needsNote ? "Note (required for Other)" : "Optional note, e.g. needs a CPA"} />
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" disabled={!can} style={{ ...btnPrimary, minHeight: 34, padding: "0 14px", fontSize: 14, opacity: can ? 1 : 0.5 }}
          onClick={async () => { setBusy(true); const ok = await p.onSave(reason!, note); setBusy(false); if (ok) p.onCancel() }}>Mark not a fit</button>
        <button type="button" style={ghost} onClick={p.onCancel}>Cancel</button>
        {p.copies > 1 && <span style={{ color: T.MUTED, fontSize: TYPE.secondary }}>Applies to all {p.copies} listings of this job for this client.</span>}
      </div>
    </div>
  )
}

function AllClients(p: { job: QJob; clients: QClient[]; isNew: (m: QChip) => boolean; onOpen: (c: number) => void }) {
  const th: React.CSSProperties = { textAlign: "left", fontSize: TYPE.label, letterSpacing: 0.5, textTransform: "uppercase", color: T.MUTED, padding: "6px 10px", borderBottom: `1px solid ${T.BORDER_SOFT}` }
  const td: React.CSSProperties = { padding: "8px 10px", borderBottom: `1px solid ${T.BORDER_SOFT}`, verticalAlign: "top", fontSize: TYPE.secondary }
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 640 }}>
        <thead><tr><th style={th}>Client</th><th style={th}>Score</th><th style={th}>Rank</th><th style={th}>Why the matcher flagged it</th><th style={th}>Status</th><th style={th}></th></tr></thead>
        <tbody>
          {p.job.m.map((m) => (
            <tr key={m.c}>
              <td style={td}><b>{p.clients[m.c]?.name}</b>{p.isNew(m) && <span style={{ color: T.WRN_ORANGE, fontWeight: 900 }}> · new</span>}</td>
              <td style={{ ...td, color: band(m.s).ink, fontWeight: 900 }}>{m.s ?? "–"}{m.all && <div style={{ color: T.MUTED, fontWeight: 400 }}>of {m.all.map((x) => x ?? "–").join(", ")}</div>}</td>
              <td style={td}>{m.rk ?? "–"}</td>
              <td style={{ ...td, maxWidth: 520 }}>{m.why}</td>
              <td style={{ ...td, color: statusColor(m.status), fontWeight: 800 }}>{m.status ? STATUS_LABEL[m.status] : "Open"}</td>
              <td style={td}><button type="button" style={small} onClick={() => p.onOpen(m.c)}>Open</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Listings(p: { job: QJob; onSaveUrl: Props["onSaveUrl"] }) {
  const td: React.CSSProperties = { padding: "8px 10px", borderBottom: `1px solid ${T.BORDER_SOFT}`, verticalAlign: "top", fontSize: TYPE.secondary }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 560 }}>
          <tbody>
            {p.job.ls!.map((l, i) => (
              <tr key={l.postingId}>
                <td style={{ ...td, color: T.SUCCESS, fontWeight: 900, whiteSpace: "nowrap" }}>{i === 0 ? "Best link" : ""}</td>
                <td style={td}><b>{l.t}</b><div style={{ color: T.MUTED }}>{l.co}</div></td>
                <td style={td}>{l.loc || "not stated"}</td>
                <td style={td}>
                  {l.url ? <a href={l.url} target="_blank" rel="noopener noreferrer" style={{ color: T.INK_LINK }}>{KIND[l.lk ?? ""] ?? "Link"} ↗</a> : "no link"}
                  {l.closed && <div style={{ color: T.ERROR }}>Likely closed</div>}
                  {l.lcs === "open" && <div style={{ color: T.MUTED }}>checked: open</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ color: T.MUTED, fontSize: TYPE.secondary }}>Decisions and flags apply to every listing. Best link: employer site, then job board, then republisher; checked open first.</div>
      <SaveUrl job={p.job} onSaveUrl={p.onSaveUrl} />
    </div>
  )
}

function SaveUrl(p: { job: QJob; onSaveUrl: Props["onSaveUrl"] }) {
  const [url, setUrl] = useState("")
  const [busy, setBusy] = useState(false)
  const google = `https://www.google.com/search?q=${encodeURIComponent(`"${p.job.t}" "${p.job.co}"`)}`
  const valid = /^https?:\/\/\S+$/i.test(url.trim())
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <a href={google} target="_blank" rel="noopener noreferrer" style={{ ...small, display: "inline-flex", alignItems: "center", textDecoration: "none" }}>Find this job ↗</a>
      <input style={{ ...input, flex: "1 1 280px", maxWidth: 520 }} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste a working link (the employer's page if you can find it)" />
      <button type="button" disabled={!valid || busy} style={{ ...small, opacity: valid && !busy ? 1 : 0.5 }}
        onClick={async () => { setBusy(true); if (await p.onSaveUrl(p.job, url.trim())) setUrl(""); setBusy(false) }}>Save link for every client</button>
    </div>
  )
}
