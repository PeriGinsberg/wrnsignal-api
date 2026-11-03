"use client"

// Job Queue: every job the nightly matcher found for the coach's clients, one
// row per job, a chip per client. Copies of one job (the same job through
// several sites) are one row; a decision is saved on every copy.
//
//   Add Job      opens the client's Source a Job tab in a new tab, prefilled
//                with the job and its description, and marks it Evaluating.
//                Sending it to the client's tracker there marks it Fit.
//   Not a fit    a reason (Other needs a note), saved for the client.
//   Row flags    Closed / Not in the US take the job out of your practice's clients'
//                queue; Bad link ranks it last until a working link is saved.
//   N cities     one employer's job under one title in several cities shows
//                as one row (display only: each city stays its own job). The
//                row's actions apply to every city; open it to act on one.
//
// API: app/api/coach/job-queue (lib/match/jobQueue.ts), loaded in pages.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { T, btnSecondary, card, input, selectDark, selectDarkOption } from "../../../../lib/dashboard-theme"
import { TYPE } from "../../../../lib/theme/surfaces"
import { authFetch } from "../_tasks/taskClient"
import { BackToDashboard } from "../BackToDashboard"
import { CHIP_FLOOR, JobQueueRow } from "./JobQueueRow"
import type { QChip, QJob, QueuePage, QueueResponse } from "./types"

const PAGE = 40
/** Ids per write: the API takes up to 120. */
const WRITE_CHUNK = 100

type Row = { job: QJob; eligible: QChip[]; visible: QChip[]; under: number; cities?: Row[] }

const best = (j: QJob) => j.m[0]?.s ?? -1
/** The server's order (lib/match/jobQueue.ts buildJobs): pages can arrive in any order. */
const byBest = (a: QJob, b: QJob) => best(b) - best(a) || b.m.length - a.m.length || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
const locKey = (l?: string) => (l ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
function chunks<T>(xs: T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += WRITE_CHUNK) out.push(xs.slice(i, i + WRITE_CHUNK))
  return out
}
const STATUS_WORD: Record<string, string> = { evaluating: "Evaluating", fit: "Fit", not_fit: "Not a fit" }

/** One chip per client across a city group's jobs: best score, every city's match ids. */
function mergeChips(parts: { job: QJob; chips: QChip[] }[]): QChip[] {
  const by = new Map<number, { job: QJob; m: QChip }[]>()
  for (const p of parts) for (const m of p.chips) by.set(m.c, [...(by.get(m.c) ?? []), { job: p.job, m }])
  return [...by.entries()].map(([c, xs]): QChip => {
    xs.sort((a, b) => (b.m.s ?? -1) - (a.m.s ?? -1))
    const top = xs[0]
    const st = xs.map((x) => x.m.status ?? "open")
    const same = st.every((x) => x === st[0])
    let split: string | undefined
    if (!same) {
      const n = new Map<string, number>()
      for (const x of st) if (x !== "open") n.set(x, (n.get(x) ?? 0) + 1)
      split = [...n.entries()].map(([k, v]) => `${STATUS_WORD[k]} in ${v}`).join(", ") + ` of ${xs.length} cities`
    }
    const ranks = xs.map((x) => x.m.rk).filter((r): r is number => r !== undefined)
    const qs = xs.map((x) => x.m.q).filter((q): q is string => !!q).sort()
    const fit = xs.find((x) => x.m.jobfitScore !== undefined)?.m
    return {
      c, s: top.m.s, why: top.m.why, q: qs[0], rk: ranks.length ? Math.min(...ranks) : undefined,
      ids: xs.flatMap((x) => x.m.ids),
      // A city already sent to the tracker (Fit) is never turned down from the group row.
      actIds: xs.filter((x) => x.m.status !== "fit").flatMap((x) => x.m.ids),
      status: same ? top.m.status : undefined,
      reason: same && xs.every((x) => x.m.reason === top.m.reason) ? top.m.reason : undefined,
      note: same ? top.m.note : undefined,
      jobfitScore: fit?.jobfitScore, jobfitDecision: fit?.jobfitDecision,
      alreadyAdded: same && xs.every((x) => x.m.alreadyAdded) ? true : undefined,
      n: xs.length, bestKey: top.job.key, bestLoc: top.job.loc, split,
    }
  }).sort((a, b) => (b.s ?? -1) - (a.s ?? -1))
}

/** Rows (best first) of one title at one employer in two or more places -> one row. */
function cityGroup(ck: string, members: Row[], floorOf: (key: string) => number): Row {
  const js = members.map((r) => r.job)
  const b = js[0]
  const flags = js.map((j) => j.flag)
  const key = `city:${ck}`
  const cities = new Set(js.map((j) => locKey(j.loc))).size
  const job: QJob = {
    ...b, key, ls: undefined, ck,
    loc: `${cities} cities`,
    postingIds: js.flatMap((j) => j.postingIds),
    m: mergeChips(js.map((j) => ({ job: j, chips: j.m }))),
    flag: flags.every((x) => x === flags[0]) ? flags[0] : undefined,
    badLink: js.every((j) => j.badLink) || undefined, closed: js.every((j) => j.closed) || undefined, rep: js.every((j) => j.rep) || undefined,
    lcs: js.every((j) => j.lcs) ? b.lcs : undefined,
    seen: js.map((j) => j.seen).filter((x): x is string => !!x).sort()[0],
    campus: js.some((j) => j.campus) || undefined,
    members: js.map((j) => j.key), cities,
  }
  const eligible = mergeChips(members.map((r) => ({ job: r.job, chips: r.eligible })))
  const fl = floorOf(key)
  return { job, eligible, visible: eligible.filter((m) => (m.s ?? -1) >= fl), under: eligible.filter((m) => (m.s ?? -1) < fl).length, cities: members }
}

type Filters = {
  q: string; client: string; min: number; loc: string; co: string; days: string; flag: string
  newOnly: boolean; campus: boolean; hideDecided: boolean; under: boolean; unscored: boolean
}
const DEFAULTS: Filters = { q: "", client: "", min: 50, loc: "", co: "", days: "any", flag: "any", newOnly: false, campus: false, hideDecided: true, under: false, unscored: false }

export default function JobQueuePage() {
  const [data, setData] = useState<QueueResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ got: number; of: number } | null>(null)
  const runRef = useRef(0)
  const [f, setF] = useState<Filters>(DEFAULTS)
  const [shown, setShown] = useState(PAGE)
  const [underRows, setUnderRows] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<string | null>(null)
  // Jobs acted on during this visit stay on screen with their new status, even
  // with "Hide jobs I've decided" on: hiding them is what made a Fit look lost.
  const [touched, setTouched] = useState<Set<string>>(new Set())
  const touch = (key: string) => setTouched((t) => (t.has(key) ? t : new Set(t).add(key)))

  const say = useCallback((msg: string) => { setToast(msg); window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 3200) }, [])

  // Filters the database applies (app/api/coach/job-queue): changing one loads
  // again. Decisions made since this visit began always load, so a job acted
  // on here keeps its new status with "Hide jobs I've decided" on.
  const visitStart = useRef(new Date().toISOString())
  const clientId = f.client !== "" ? data?.clients[Number(f.client)]?.id ?? "" : ""
  const query = new URLSearchParams({
    min: String(f.min), since: visitStart.current,
    ...(clientId ? { client: clientId } : {}),
    ...(f.hideDecided ? {} : { decided: "1" }),
    ...(f.unscored && clientId ? { unscored: "1" } : {}),
  }).toString()
  const queryRef = useRef(query)
  queryRef.current = query

  // The list comes in pages (one response is capped at 4.5 MB). Page 0 has
  // the clients and the first jobs and shows at once; the rest follow in
  // parallel. A quiet reload (coming back to the tab) swaps in the whole new
  // list once every page is in.
  const load = useCallback(async (quiet = false) => {
    const run = ++runRef.current
    const fetchPage = async (n: number, snap: string): Promise<QueuePage> => {
      const r = await authFetch(`/api/coach/job-queue?page=${n}&${queryRef.current}${snap ? `&snap=${encodeURIComponent(snap)}` : ""}`)
      const j = await r.json().catch(() => null)
      if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`)
      return j
    }
    try {
      const first = await fetchPage(0, "")
      if (run !== runRef.current) return
      const head: QueueResponse = { ok: true, asOf: first.asOf!, lastVisitAt: first.lastVisitAt, minScoreLoaded: first.minScoreLoaded!, reasons: first.reasons!, clients: first.clients!, jobs: first.jobs }
      const idx = new Map(head.clients.map((c, i) => [c.id, i]))
      let all = first.jobs
      if (!quiet) { setData(head); setError(null) }
      if (first.pages > 1) {
        let got = 1
        if (!quiet) setProgress({ got, of: first.pages })
        await Promise.all(Array.from({ length: first.pages - 1 }, (_, i) => fetchPage(i + 1, first.snap).then((pg) => {
          if (run !== runRef.current) return
          // A page that was built again names its clients: map its chips onto page 0's list.
          const remap = pg.clientIds?.map((id) => idx.get(id))
          const jobs = remap
            ? pg.jobs.map((j) => ({ ...j, m: j.m.filter((m) => remap[m.c] !== undefined).map((m) => ({ ...m, c: remap[m.c]! })) }))
            : pg.jobs
          all = all.concat(jobs)
          got++
          if (!quiet) {
            setData((d) => { if (!d) return d; const have = new Set(d.jobs.map((j) => j.key)); return { ...d, jobs: d.jobs.concat(jobs.filter((j) => !have.has(j.key))) } })
            setProgress({ got, of: first.pages })
          }
        })))
      }
      if (run !== runRef.current) return
      if (quiet) {
        const have = new Set<string>()
        setData({ ...head, jobs: all.filter((j) => { if (have.has(j.key)) return false; have.add(j.key); return true }) })
      }
      setProgress(null)
    } catch (e: any) {
      if (run !== runRef.current) return
      setProgress(null)
      if (!quiet) setError(String(e?.message || e))
    }
  }, [])
  useEffect(() => { load() }, [load, query])
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
  const ordered = useMemo(() => (data ? [...data.jobs].sort(byBest) : []), [data])
  const rows = useMemo(() => {
    if (!data) return []
    const clientIdx = f.client === "" ? -1 : Number(f.client)
    const q = f.q.trim().toLowerCase(), loc = f.loc.trim().toLowerCase(), co = f.co.trim().toLowerCase()
    const now = Date.now()
    const out: Row[] = []
    for (const j of ordered) {
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
      if (!eligible.length || ((eligible[0].s ?? -1) < f.min && !(f.unscored && eligible[0].s === undefined))) continue
      const floor = f.under || underRows.has(j.key) ? 0 : CHIP_FLOOR
      out.push({ job: j, eligible, visible: eligible.filter((m) => (m.s ?? -1) >= floor), under: eligible.filter((m) => (m.s ?? -1) < floor).length })
    }
    // One title at one employer in two or more places: one row, "N cities",
    // at the place of its best city. Built from the jobs the filters kept.
    const byCk = new Map<string, Row[]>()
    for (const r of out) { const k = r.job.ck ?? r.job.key; byCk.set(k, [...(byCk.get(k) ?? []), r]) }
    const floorOf = (key: string) => (f.under || underRows.has(key) ? 0 : CHIP_FLOOR)
    const grouped: Row[] = []
    const done = new Set<string>()
    for (const r of out) {
      const k = r.job.ck ?? r.job.key
      const g = byCk.get(k)!
      if (g.length < 2 || new Set(g.map((x) => locKey(x.job.loc))).size < 2) { grouped.push(r); continue }
      if (done.has(k)) continue
      done.add(k)
      grouped.push(cityGroup(k, g, floorOf))
    }
    return grouped
  }, [data, ordered, f, isNew, underRows, touched])

  const sinceStats = useMemo(() => {
    if (!data) return null
    let jobs = 0, hi = 0
    for (const j of data.jobs) { const n = j.m.filter(isNew); if (n.length) { jobs++; hi += n.filter((m) => (m.s ?? 0) >= 70).length } }
    return { jobs, hi }
  }, [data, isNew])

  // ---- writes: call the API, then update the page's copy -------------------
  // A city group is not in data: its writes go to every member job, and a
  // chip changes only where it holds one of the match ids written.
  const keysOf = (job: QJob) => job.members ?? [job.key]
  const patchJob = (job: QJob, fn: (j: QJob) => QJob) => {
    const keys = new Set(keysOf(job))
    setData((d) => (d ? { ...d, jobs: d.jobs.map((j) => (keys.has(j.key) ? fn(j) : j)) } : d))
  }
  const patchChip = (job: QJob, c: number, ids: string[], fn: (m: QChip) => QChip) => {
    const written = new Set(ids)
    patchJob(job, (j) => ({ ...j, m: j.m.map((m) => (m.c === c && m.ids.some((id) => written.has(id)) ? fn(m) : m)) }))
  }
  const touchAll = (job: QJob) => { touch(job.key); keysOf(job).forEach(touch) }
  const decide = (clientId: string, ids: string[], body: Record<string, unknown>) =>
    Promise.all(chunks(ids).map((part) => call("/api/coach/job-queue/match", "PATCH", { client_profile_id: clientId, match_ids: part, ...body })))
  const call = async (url: string, method: string, body: unknown) => {
    const r = await authFetch(url, { method, body: JSON.stringify(body) })
    const j = await r.json().catch(() => null)
    if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`)
    return j
  }
  const clientOf = (m: QChip) => data!.clients[m.c]

  const onAddJob = (job: QJob, m: QChip) => {
    // On a city group: the city where this client scores best.
    if (job.members) {
      const city = data!.jobs.find((j) => j.key === m.bestKey)
      const cm = city?.m.find((x) => x.c === m.c)
      if (city && cm) { touch(job.key); onAddJob(city, cm) }
      return
    }
    const c = clientOf(m)
    const qs = new URLSearchParams({ tab: "source", sc_title: job.t, sc_company: job.co, sc_url: job.url ?? "", match: m.ids.join(",") })
    window.open(`/dashboard/coach/clients/${c.id}?${qs}`, "_blank", "noopener")
    touch(job.key)
    if (m.status) return
    decide(c.id, m.ids, { action: "evaluating" })
      .then(() => { patchChip(job, m.c, m.ids, (x) => ({ ...x, status: "evaluating" })); say(`${c.first}: Evaluating. Send it to their tracker in the new tab to mark it Fit.`) })
      .catch((e) => say(`Could not mark Evaluating: ${e.message}`))
  }
  const onNotFit = async (job: QJob, m: QChip, reason: string, note: string) => {
    const c = clientOf(m)
    try {
      const ids = m.actIds ?? m.ids
      if (!ids.length) { say(`${c.first} already has this job as a Fit in every city.`); return false }
      await decide(c.id, ids, { action: "dismiss", reason, note })
      touchAll(job)
      patchChip(job, m.c, ids, (x) => ({ ...x, status: "not_fit", reason, note: note.trim() || undefined }))
      const where = job.cities ? ` in ${m.n ?? job.cities} cities` : ""
      say(`Not a fit for ${c.first}${where}: ${data!.reasons.find((r) => r.value === reason)?.label.replace(" (note required)", "") ?? reason}`)
      return true
    } catch (e: any) { say(`Not saved: ${e.message}`); return false }
  }
  // Already added: it is in the client's tracker already, so a Fit with nothing
  // added and no JobFit. On a city group, the city where this client scores best.
  const onAlreadyAdded = (job: QJob, m: QChip) => {
    if (job.members) {
      const city = data!.jobs.find((j) => j.key === m.bestKey)
      const cm = city?.m.find((x) => x.c === m.c)
      if (city && cm) { touch(job.key); onAlreadyAdded(city, cm) }
      return
    }
    const c = clientOf(m)
    decide(c.id, m.ids, { action: "push", already_added: true })
      .then(() => {
        touch(job.key)
        patchChip(job, m.c, m.ids, (x) => ({ ...x, status: "fit", alreadyAdded: true, reason: undefined }))
        say(`${c.first}: Fit, already in their tracker.`)
      })
      .catch((e) => say(`Not saved: ${e.message}`))
  }
  const onUndo = (job: QJob, m: QChip) => {
    decide(clientOf(m).id, m.ids, { action: null })
      .then(() => patchChip(job, m.c, m.ids, (x) => ({ ...x, status: undefined, reason: undefined, note: undefined, alreadyAdded: undefined })))
      .catch((e) => say(`Undo failed: ${e.message}`))
  }
  const onFlag = (job: QJob, flag: QJob["flag"] | null) => {
    Promise.all(chunks(job.postingIds).map((part) => call("/api/coach/job-queue/posting", "POST", { posting_ids: part, flag })))
      .then(() => {
        touchAll(job)
        patchJob(job, (j) => ({ ...j, flag: flag ?? undefined, badLink: flag === "bad_link" ? true : flag === null ? false : j.badLink }))
        const where = job.cities ? ` in all ${job.cities} cities` : ""
        say(flag ? `Marked ${flag === "not_us" ? "not in the US" : flag.replace("_", " ")}${where} for your clients${flag !== "bad_link" ? " and taken out of their queues" : ""}.` : "Flag removed.")
      })
      .catch((e) => say(`Not saved: ${e.message}`))
  }
  const onSaveUrl = async (job: QJob, url: string) => {
    try {
      await call("/api/coach/job-queue/posting", "POST", { posting_ids: job.postingIds, apply_url: url })
      patchJob(job, (j) => ({ ...j, url, lk: "employer", rep: false, badLink: false }))
      say("Link saved for your clients on this job.")
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
  const check = (l: string, k: "newOnly" | "campus" | "hideDecided" | "under" | "unscored", disabled = false, title?: string) => (
    <label title={title} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: TYPE.secondary, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1 }}>
      <input type="checkbox" disabled={disabled} checked={f[k] && !disabled} onChange={(e) => set(k, e.target.checked)} /> {l}
    </label>
  )
  const renderRow = (r: Row): React.ReactNode => (
    <JobQueueRow key={r.job.key} job={r.job} clients={data!.clients} reasons={data!.reasons} visible={r.visible} under={r.under}
      showingUnder={f.under || underRows.has(r.job.key)} isNew={isNew}
      onToggleUnder={() => setUnderRows((s) => { const n = new Set(s); if (n.has(r.job.key)) n.delete(r.job.key); else n.add(r.job.key); return n })}
      onAddJob={onAddJob} onNotFit={onNotFit} onUndo={onUndo} onAlreadyAdded={onAlreadyAdded} onFlag={onFlag} onSaveUrl={onSaveUrl} loadDetails={loadDetails}
      renderCities={r.cities ? () => r.cities!.map(renderRow) : undefined} />
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
          {check("Include jobs not yet scored", "unscored", !clientId, clientId ? "Jobs the matcher has not judged yet: often thousands" : "Pick one client first")}
        </div>
      </div>

      {error && <div style={{ ...card, padding: 16, color: T.ERROR, background: T.ERROR_BG }}>Could not load the Job Queue: {error}</div>}
      {!data && !error && <div style={{ color: T.MUTED }}>Loading every client's queue…</div>}
      {data && (
        <>
          {progress && <div style={{ color: T.MUTED, fontSize: TYPE.secondary }}>Loading more jobs: part {progress.got} of {progress.of}. The list fills in as they arrive.</div>}
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, color: T.MUTED, fontSize: TYPE.secondary }}>
            <span><b style={{ color: T.TEXT }}>{rows.length.toLocaleString()}</b> jobs · <b style={{ color: T.TEXT }}>{rows.reduce((n, r) => n + r.visible.length, 0).toLocaleString()}</b> client matches across <b style={{ color: T.TEXT }}>{clientsInView.size}</b> clients</span>
            <span>Sorted by best client score · jobs any client scored {data.minScoreLoaded}+</span>
          </div>
          {rows.length === 0 && <div style={{ ...card, padding: 24, color: T.MUTED }}>No jobs match these filters. Lower the minimum score or clear the search.</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {rows.slice(0, shown).map(renderRow)}
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
