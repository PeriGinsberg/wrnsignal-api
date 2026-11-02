"use client"

// Job Queue: every job the nightly matcher found for the coach's clients, one
// row per job, a chip per client. Copies of one job (the same job through
// several sites) are one row; a decision is saved on every copy.
//
//   Add Job      opens the client's Source a Job tab in a new tab, prefilled
//                with the job and its description, and marks it Evaluating.
//                Sending it to the client's tracker there marks it Fit.
//   Not a fit    a reason (Other needs a note), saved for the client.
//   Row flags    Closed / Not in the US take the job out of every client's
//                queue; Bad link ranks it last until a working link is saved.
//
// API: app/api/coach/job-queue (lib/match/jobQueue.ts).

import { useCallback, useEffect, useMemo, useState } from "react"
import { T, btnSecondary, card, input, selectDark, selectDarkOption } from "../../../../lib/dashboard-theme"
import { TYPE } from "../../../../lib/theme/surfaces"
import { authFetch } from "../_tasks/taskClient"
import { BackToDashboard } from "../BackToDashboard"
import { CHIP_FLOOR, JobQueueRow } from "./JobQueueRow"
import type { QChip, QJob, QueueResponse } from "./types"

const PAGE = 40

type Filters = {
  q: string; client: string; min: number; loc: string; co: string; days: string; flag: string
  newOnly: boolean; campus: boolean; hideDecided: boolean; under: boolean
}
const DEFAULTS: Filters = { q: "", client: "", min: 50, loc: "", co: "", days: "any", flag: "any", newOnly: false, campus: false, hideDecided: true, under: false }

export default function JobQueuePage() {
  const [data, setData] = useState<QueueResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [f, setF] = useState<Filters>(DEFAULTS)
  const [shown, setShown] = useState(PAGE)
  const [underRows, setUnderRows] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<string | null>(null)
  // Jobs acted on during this visit stay on screen with their new status, even
  // with "Hide jobs I've decided" on: hiding them is what made a Fit look lost.
  const [touched, setTouched] = useState<Set<string>>(new Set())
  const touch = (key: string) => setTouched((t) => (t.has(key) ? t : new Set(t).add(key)))

  const say = useCallback((msg: string) => { setToast(msg); window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 3200) }, [])

  const load = useCallback((quiet = false) => {
    return authFetch("/api/coach/job-queue").then(async (r) => {
      const j = await r.json().catch(() => null)
      if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`)
      setData(j)
    }).catch((e) => { if (!quiet) setError(String(e?.message || e)) })
  }, [])
  useEffect(() => { load() }, [load])
  // Add Job finishes in another tab (Source a Job marks the job Fit there).
  // Coming back to this tab reloads, so the Fit shows. At most once a minute.
  useEffect(() => {
    let last = Date.now()
    const onVisible = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < 60e3) return
      last = Date.now()
      load(true)
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => document.removeEventListener("visibilitychange", onVisible)
  }, [load])

  const lastVisit = data?.lastVisitAt ?? null
  const isNew = useCallback((m: QChip) => !!lastVisit && !!m.q && m.q > lastVisit, [lastVisit])
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => { setF((x) => ({ ...x, [k]: v })); setShown(PAGE) }

  // ---- filtering -----------------------------------------------------------
  const rows = useMemo(() => {
    if (!data) return []
    const clientIdx = f.client === "" ? -1 : Number(f.client)
    const q = f.q.trim().toLowerCase(), loc = f.loc.trim().toLowerCase(), co = f.co.trim().toLowerCase()
    const now = Date.now()
    const out: { job: QJob; visible: QChip[]; under: number }[] = []
    for (const j of data.jobs) {
      const keep = touched.has(j.key)
      if (f.hideDecided && !keep && j.flag && j.flag !== "bad_link") continue
      if (q && !`${j.t} ${j.co}`.toLowerCase().includes(q)) continue
      if (loc && !(j.loc ?? "").toLowerCase().includes(loc)) continue
      if (co && !j.co.toLowerCase().includes(co)) continue
      if (f.campus && !j.campus) continue
      if (f.days !== "any" && !(j.seen && now - new Date(j.seen).getTime() <= Number(f.days) * 864e5)) continue
      if (f.flag === "closed" && !j.closed) continue
      if (f.flag === "rep" && !j.rep) continue
      if (f.flag === "unchecked" && j.lcs) continue
      if (f.flag === "deadline" && !j.dl) continue
      if (f.flag === "badlink" && !j.badLink) continue
      if (f.flag === "clean" && (j.closed || j.rep || j.badLink)) continue
      const eligible = j.m.filter((m) => (clientIdx < 0 || m.c === clientIdx) && (!f.newOnly || isNew(m)) && (!f.hideDecided || keep || !m.status || m.status === "evaluating"))
      if (!eligible.length || (eligible[0].s ?? -1) < f.min) continue
      const floor = f.under || underRows.has(j.key) ? 0 : CHIP_FLOOR
      out.push({ job: j, visible: eligible.filter((m) => (m.s ?? -1) >= floor), under: eligible.filter((m) => (m.s ?? -1) < floor).length })
    }
    return out
  }, [data, f, isNew, underRows, touched])

  const sinceStats = useMemo(() => {
    if (!data) return null
    let jobs = 0, hi = 0
    for (const j of data.jobs) { const n = j.m.filter(isNew); if (n.length) { jobs++; hi += n.filter((m) => (m.s ?? 0) >= 70).length } }
    return { jobs, hi }
  }, [data, isNew])

  // ---- writes: call the API, then update the page's copy -------------------
  const patchJob = (key: string, fn: (j: QJob) => QJob) =>
    setData((d) => (d ? { ...d, jobs: d.jobs.map((j) => (j.key === key ? fn(j) : j)) } : d))
  const patchChip = (key: string, c: number, fn: (m: QChip) => QChip) =>
    patchJob(key, (j) => ({ ...j, m: j.m.map((m) => (m.c === c ? fn(m) : m)) }))
  const call = async (url: string, method: string, body: unknown) => {
    const r = await authFetch(url, { method, body: JSON.stringify(body) })
    const j = await r.json().catch(() => null)
    if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`)
    return j
  }
  const clientOf = (m: QChip) => data!.clients[m.c]

  const onAddJob = (job: QJob, m: QChip) => {
    const c = clientOf(m)
    const qs = new URLSearchParams({ tab: "source", sc_title: job.t, sc_company: job.co, sc_url: job.url ?? "", match: m.ids.join(",") })
    window.open(`/dashboard/coach/clients/${c.id}?${qs}`, "_blank", "noopener")
    touch(job.key)
    if (m.status) return
    call("/api/coach/job-queue/match", "PATCH", { client_profile_id: c.id, match_ids: m.ids, action: "evaluating" })
      .then(() => { patchChip(job.key, m.c, (x) => ({ ...x, status: "evaluating" })); say(`${c.first}: Evaluating. Send it to their tracker in the new tab to mark it Fit.`) })
      .catch((e) => say(`Could not mark Evaluating: ${e.message}`))
  }
  const onNotFit = async (job: QJob, m: QChip, reason: string, note: string) => {
    const c = clientOf(m)
    try {
      await call("/api/coach/job-queue/match", "PATCH", { client_profile_id: c.id, match_ids: m.ids, action: "dismiss", reason, note })
      touch(job.key)
      patchChip(job.key, m.c, (x) => ({ ...x, status: "not_fit", reason, note: note.trim() || undefined }))
      say(`Not a fit for ${c.first}: ${data!.reasons.find((r) => r.value === reason)?.label.replace(" (note required)", "") ?? reason}`)
      return true
    } catch (e: any) { say(`Not saved: ${e.message}`); return false }
  }
  const onUndo = (job: QJob, m: QChip) => {
    call("/api/coach/job-queue/match", "PATCH", { client_profile_id: clientOf(m).id, match_ids: m.ids, action: null })
      .then(() => patchChip(job.key, m.c, (x) => ({ ...x, status: undefined, reason: undefined, note: undefined })))
      .catch((e) => say(`Undo failed: ${e.message}`))
  }
  const onFlag = (job: QJob, flag: QJob["flag"] | null) => {
    call("/api/coach/job-queue/posting", "POST", { posting_ids: job.postingIds, flag })
      .then(() => {
        touch(job.key)
        patchJob(job.key, (j) => ({ ...j, flag: flag ?? undefined, badLink: flag === "bad_link" ? true : flag === null ? false : j.badLink }))
        say(flag ? `Marked ${flag === "not_us" ? "not in the US" : flag.replace("_", " ")} for every client${flag !== "bad_link" ? " and taken out of their queues" : ""}.` : "Flag removed.")
      })
      .catch((e) => say(`Not saved: ${e.message}`))
  }
  const onSaveUrl = async (job: QJob, url: string) => {
    try {
      await call("/api/coach/job-queue/posting", "POST", { posting_ids: job.postingIds, apply_url: url })
      patchJob(job.key, (j) => ({ ...j, url, lk: "employer", rep: false, badLink: false }))
      say("Link saved for every client on this job.")
      return true
    } catch (e: any) { say(`Not saved: ${e.message}`); return false }
  }
  const loadDetails = async (job: QJob) => {
    try {
      const id = job.m[0]?.ids[0]
      if (!id) return null
      const r = await authFetch(`/api/coach/job-queue/posting?match_id=${encodeURIComponent(id)}`)
      const j = await r.json()
      return r.ok ? { requirements_summary: j.requirements_summary } : null
    } catch { return null }
  }

  // ---- render --------------------------------------------------------------
  const label: React.CSSProperties = { fontSize: TYPE.label, fontWeight: 900, letterSpacing: 0.5, textTransform: "uppercase", color: T.MUTED }
  const fld = (l: string, el: React.ReactNode, wide = false) => (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, gridColumn: wide ? "span 2" : undefined, minWidth: 0 }}><span style={label}>{l}</span>{el}</label>
  )
  const check = (l: string, k: "newOnly" | "campus" | "hideDecided" | "under") => (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: TYPE.secondary, cursor: "pointer" }}>
      <input type="checkbox" checked={f[k]} onChange={(e) => set(k, e.target.checked)} /> {l}
    </label>
  )
  const clientsInView = new Set<number>()
  rows.forEach((r) => r.visible.forEach((m) => clientsInView.add(m.c)))

  return (
    <div style={{ padding: "24px max(16px, env(safe-area-inset-right, 0px)) 48px max(16px, env(safe-area-inset-left, 0px))", maxWidth: 1280, margin: "0 auto", color: T.TEXT, display: "flex", flexDirection: "column", gap: 16 }}>
      <BackToDashboard />
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div>
          <h1 style={{ fontSize: TYPE.title, fontWeight: 900, margin: 0 }}>Job Queue</h1>
          <p style={{ margin: "4px 0 0", color: T.MUTED }}>Every job the matcher found for your clients, one row per job.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {data && <span style={{ fontSize: TYPE.secondary, color: T.MUTED }}>Last visit <b style={{ color: T.TEXT }}>{lastVisit ? new Date(lastVisit).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "first visit"}</b>{sinceStats && lastVisit ? <> · <b style={{ color: T.TEXT }}>{sinceStats.jobs.toLocaleString()}</b> jobs new since · <b style={{ color: T.TEXT }}>{sinceStats.hi}</b> new matches at 70+</> : null}</span>}
          <a href="/dashboard/coach/job-queue/proposals" style={{ ...btnSecondary, minHeight: 34, padding: "0 14px", fontSize: 14, display: "inline-flex", alignItems: "center", textDecoration: "none" }}>Criteria proposals</a>
        </div>
      </div>

      <div style={{ ...card, padding: 16, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12, overflow: "visible" }}>
        {fld("Search title or company", <input style={input} value={f.q} onChange={(e) => set("q", e.target.value)} placeholder="e.g. project coordinator, Deloitte" />, true)}
        {fld("Client", <select style={selectDark} value={f.client} onChange={(e) => set("client", e.target.value)}>
          <option style={selectDarkOption} value="">All clients</option>
          {data?.clients.map((c, i) => <option style={selectDarkOption} key={c.id} value={String(i)}>{c.name}</option>)}
        </select>)}
        {fld("Best client score", <select style={selectDark} value={f.min} onChange={(e) => set("min", Number(e.target.value))}>
          {[30, 50, 70, 85].map((n) => <option style={selectDarkOption} key={n} value={n}>{n}+</option>)}
        </select>)}
        {fld("Location", <input style={input} value={f.loc} onChange={(e) => set("loc", e.target.value)} placeholder="City or state" />)}
        {fld("Company", <input style={input} value={f.co} onChange={(e) => set("co", e.target.value)} placeholder="Employer" />)}
        {fld("Date found", <select style={selectDark} value={f.days} onChange={(e) => set("days", e.target.value)}>
          <option style={selectDarkOption} value="any">Any time</option><option style={selectDarkOption} value="1">Last 24 hours</option>
          <option style={selectDarkOption} value="3">Last 3 days</option><option style={selectDarkOption} value="7">Last 7 days</option>
        </select>)}
        {fld("Flags", <select style={selectDark} value={f.flag} onChange={(e) => set("flag", e.target.value)}>
          <option style={selectDarkOption} value="any">Any</option><option style={selectDarkOption} value="clean">No warning flags</option>
          <option style={selectDarkOption} value="closed">Likely closed</option><option style={selectDarkOption} value="badlink">Bad link</option>
          <option style={selectDarkOption} value="rep">Republished link only</option><option style={selectDarkOption} value="unchecked">Link not checked</option>
          <option style={selectDarkOption} value="deadline">Has a deadline</option>
        </select>)}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, gridColumn: "span 2" }}>
          {check("New since my last visit", "newOnly")}
          {check("Campus only", "campus")}
          {check("Hide jobs I've decided", "hideDecided")}
          {check(`Show clients under ${CHIP_FLOOR}`, "under")}
        </div>
      </div>

      {error && <div style={{ ...card, padding: 16, color: T.ERROR, background: T.ERROR_BG }}>Could not load the Job Queue: {error}</div>}
      {!data && !error && <div style={{ color: T.MUTED }}>Loading every client's queue…</div>}
      {data && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, color: T.MUTED, fontSize: TYPE.secondary }}>
            <span><b style={{ color: T.TEXT }}>{rows.length.toLocaleString()}</b> jobs · <b style={{ color: T.TEXT }}>{rows.reduce((n, r) => n + r.visible.length, 0).toLocaleString()}</b> client matches across <b style={{ color: T.TEXT }}>{clientsInView.size}</b> clients</span>
            <span>Sorted by best client score · jobs any client scored {data.minScoreLoaded}+</span>
          </div>
          {rows.length === 0 && <div style={{ ...card, padding: 24, color: T.MUTED }}>No jobs match these filters. Lower the minimum score or clear the search.</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {rows.slice(0, shown).map((r) => (
              <JobQueueRow key={r.job.key} job={r.job} clients={data.clients} reasons={data.reasons} visible={r.visible} under={r.under}
                showingUnder={f.under || underRows.has(r.job.key)} isNew={isNew}
                onToggleUnder={() => setUnderRows((s) => { const n = new Set(s); n.has(r.job.key) ? n.delete(r.job.key) : n.add(r.job.key); return n })}
                onAddJob={onAddJob} onNotFit={onNotFit} onUndo={onUndo} onFlag={onFlag} onSaveUrl={onSaveUrl} loadDetails={loadDetails} />
            ))}
          </div>
          {rows.length > shown && <button type="button" style={{ ...btnSecondary, alignSelf: "center" }} onClick={() => setShown((n) => n + PAGE)}>Show {PAGE} more</button>}
        </>
      )}
      {toast && (
        <div role="status" style={{ position: "fixed", bottom: "calc(24px + env(safe-area-inset-bottom, 0px))", left: "50%", transform: "translateX(-50%)", background: T.NAV_BG, border: `1px solid ${T.BORDER}`, borderRadius: 12, padding: "10px 16px", boxShadow: T.SHADOW_POPUP, zIndex: 50, maxWidth: "calc(100vw - 32px)" }}>{toast}</div>
      )}
    </div>
  )
}
