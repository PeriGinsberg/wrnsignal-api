"use client"

// components/workbook/CoachNotes.tsx
//
// Coach Notes on a workbook section, for several coaches in one live session.
// Each note is its own row, so two coaches typing at once never overwrite each
// other. A coach's own notes autosave as they type; everyone else's arrive
// live through Supabase realtime (RLS decides who receives what) and are
// read-only here. Coach-only: the client never sees these tables.
//
// Used by the Resume Workshop (resume_workshop_coach_notes). The API answers
// at <base>/notes and <base>/notes/<id>: { notes (with section_id), authors,
// me, realtime_filter }, and takes { section_id, body } / { body }.

import React, { useCallback, useEffect, useRef, useState } from "react"
import { TYPE } from "../../lib/theme/surfaces"
import { getSupabaseBrowser } from "../../lib/supabase-browser"
import { fmtWhen, getToken, wbFetch } from "./api"

const DELAY_MS = 700

export type CoachNote = {
  id: string
  section_id: string
  coach_profile_id: string
  body: string
  created_at: string
  updated_at: string
}

export type CoachNotesApi = {
  notes: CoachNote[]
  authors: Record<string, string>
  me: string | null
  error: string | null
  live: boolean
  base: string
  put(n: CoachNote): void
  drop(id: string): void
}

type Source = {
  /** The table realtime watches. */
  table: "resume_workshop_coach_notes"
  /** The column that holds the section in realtime rows (the API already maps it to section_id). */
  sectionColumn?: string
}

/** Every coach's notes for one client's workshop, kept live. One subscription per page. */
export function useCoachNotes(base: string, source: Source): CoachNotesApi {
  const { table, sectionColumn = "section_id" } = source
  const [notes, setNotes] = useState<CoachNote[]>([])
  const [authors, setAuthors] = useState<Record<string, string>>({})
  const [me, setMe] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [live, setLive] = useState(false)
  // Which rows this page listens for, from the API (it knows the client's other coaches).
  const [filter, setFilter] = useState<string | null>(null)
  const known = useRef<Record<string, string>>({})

  const load = useCallback(async () => {
    const { status, body } = await wbFetch<{ notes: CoachNote[]; authors: Record<string, string>; me: string; realtime_filter: string }>(`${base}/notes`)
    if (status !== 200) { setError(body.error || "Couldn't load coach notes."); return }
    setError(null)
    setFilter(body.realtime_filter)
    known.current = body.authors
    setAuthors(body.authors)
    setMe(body.me)
    setNotes(body.notes)
  }, [base])

  const put = useCallback((n: CoachNote) => {
    setNotes((all) => {
      const i = all.findIndex((x) => x.id === n.id)
      if (i < 0) return [...all, n]
      // Out-of-order events: keep the newer copy.
      if (all[i].updated_at > n.updated_at) return all
      const next = all.slice(); next[i] = n; return next
    })
  }, [])
  const drop = useCallback((id: string) => setNotes((all) => all.filter((x) => x.id !== id)), [])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!filter) return
    let gone = false
    const sb = getSupabaseBrowser()
    let channel: ReturnType<typeof sb.channel> | null = null
    void (async () => {
      // A coach who arrived by the Framer handoff has a token but no client
      // session; give it to realtime so RLS sees who is subscribing.
      const { data: { session } } = await sb.auth.getSession()
      if (!session) { const t = await getToken(); if (t) await sb.realtime.setAuth(t) }
      if (gone) return
      const onRow = (payload: any) => {
        const raw = payload.new as Record<string, any>
        if (!raw?.id) return
        const n = { ...raw, section_id: raw[sectionColumn] } as CoachNote
        put(n)
        // A coach who joined after the page loaded: fetch the names again.
        if (!(n.coach_profile_id in known.current)) void load()
      }
      channel = sb.channel(`coach-notes:${base}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table, filter }, onRow)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table, filter }, onRow)
        // Delete events cannot be filtered and carry only the id.
        .on("postgres_changes", { event: "DELETE", schema: "public", table }, (payload: any) => {
          if (payload.old?.id) drop(payload.old.id)
        })
        .subscribe((status) => {
          if (gone) return
          setLive(status === "SUBSCRIBED")
          // (Re)connected: catch anything sent while we were not listening.
          if (status === "SUBSCRIBED") void load()
        })
    })()
    return () => { gone = true; if (channel) void sb.removeChannel(channel) }
  }, [base, table, sectionColumn, filter, load, put, drop])

  return { notes, authors, me, error, live, base, put, drop }
}

type Draft = { key: string; id: string | null }

/** Class names, so each page keeps its own look. Defaults: the workbook style. */
export type NotesLook = { card: string; eyebrow: string; muted: string; input: string; button: string; link: string; saved: string; warn: string }
const WB_LOOK: NotesLook = {
  card: "wb-card-soft", eyebrow: "wb-eyebrow", muted: "wb-muted", input: "wb-textarea-box",
  button: "wb-btn", link: "wb-link", saved: "wb-saved", warn: "wb-warn",
}

export function CoachNotesPanel({ api, sectionId, look = WB_LOOK }: { api: CoachNotesApi; sectionId: string; look?: NotesLook }) {
  const [drafts, setDrafts] = useState<Draft[]>([])
  const draftIds = new Set(drafts.map((d) => d.id).filter(Boolean) as string[])
  const here = api.notes.filter((n) => n.section_id === sectionId && !draftIds.has(n.id))
  const shown = here.filter((n) => n.coach_profile_id === api.me || n.body.trim())

  const addDraft = () => setDrafts((d) => [...d, { key: `d${Date.now()}${Math.random()}`, id: null }])

  return (
    <section className={look.card} aria-label="Coach notes">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span className={look.eyebrow}>Coach notes</span>
        <span className={look.muted} style={{ fontSize: TYPE.secondary }}>
          Coaches only{api.live ? " · live" : ""}
        </span>
      </div>
      {api.error && <p className={look.warn} role="alert" style={{ margin: 0 }}>{api.error}</p>}
      {!shown.length && !drafts.length && (
        <span className={look.muted} style={{ fontSize: TYPE.body }}>No notes here yet.</span>
      )}
      {shown.map((n) => n.coach_profile_id === api.me
        ? <OwnNote key={n.id} api={api} sectionId={sectionId} note={n} look={look} />
        : <OtherNote key={n.id} note={n} name={api.authors[n.coach_profile_id] ?? "Coach"} look={look} />)}
      {drafts.map((d) => (
        <OwnNote key={d.key} api={api} sectionId={sectionId} note={api.notes.find((n) => n.id === d.id) ?? null} autoFocus look={look}
          onSaved={(id) => setDrafts((all) => all.map((x) => x.key === d.key ? { ...x, id } : x))}
          onRemoved={() => setDrafts((all) => all.filter((x) => x.key !== d.key))} />
      ))}
      <button type="button" className={look.button} style={{ alignSelf: "flex-start" }} onClick={addDraft} disabled={!api.me}>Add a note</button>
    </section>
  )
}

function stamp(n: CoachNote) {
  const edited = Date.parse(n.updated_at) - Date.parse(n.created_at) > 60_000
  return `${fmtWhen(n.created_at)}${edited ? ` · edited ${fmtWhen(n.updated_at)}` : ""}`
}

function OtherNote({ note, name, look }: { note: CoachNote; name: string; look: NotesLook }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
      <span style={{ fontSize: TYPE.secondary, fontWeight: 700, color: "#2E4260" }}>{name} <span className={look.muted} style={{ fontWeight: 400 }}>· {stamp(note)}</span></span>
      <p style={{ margin: 0, fontSize: TYPE.body, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{note.body}</p>
    </div>
  )
}

type Status = "idle" | "saving" | "saved" | "error"

function OwnNote(props: {
  api: CoachNotesApi; sectionId: string; note: CoachNote | null; autoFocus?: boolean; look: NotesLook
  onSaved?(id: string): void; onRemoved?(): void
}) {
  const { api, sectionId, look } = props
  const [text, setText] = useState(props.note?.body ?? "")
  const [status, setStatus] = useState<Status>("idle")
  const [err, setErr] = useState<string | null>(null)
  const id = useRef<string | null>(props.note?.id ?? null)
  const latest = useRef(text)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inflight = useRef(false)
  const again = useRef(false)

  const save = useCallback(async (): Promise<void> => {
    if (inflight.current) { again.current = true; return }
    const body = latest.current
    if (!id.current && !body.trim()) { setStatus("idle"); return }
    inflight.current = true
    again.current = false
    setStatus("saving")
    const r = id.current
      ? await wbFetch<{ note: CoachNote }>(`${api.base}/notes/${id.current}`, { method: "PATCH", body: JSON.stringify({ body }) })
      : await wbFetch<{ note: CoachNote }>(`${api.base}/notes`, { method: "POST", body: JSON.stringify({ section_id: sectionId, body }) })
    inflight.current = false
    if ((r.status === 200 || r.status === 201) && r.body.note) {
      const created = !id.current
      id.current = r.body.note.id
      api.put(r.body.note)
      if (created) props.onSaved?.(r.body.note.id)
      if (again.current) return save()
      setStatus("saved"); setErr(null)
      return
    }
    setStatus("error"); setErr(r.body.error || "Not saved. Check your connection.")
  }, [api, sectionId, props])

  const saveRef = useRef(save)
  useEffect(() => { saveRef.current = save }, [save])
  // Leaving mid-pause: send what is waiting.
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); void saveRef.current() } }, [])

  const change = (v: string) => {
    setText(v); latest.current = v; setStatus("saving")
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { timer.current = null; void saveRef.current() }, DELAY_MS)
  }

  const remove = async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    if (!id.current) { props.onRemoved?.(); return }
    const noteId = id.current
    const r = await wbFetch(`${api.base}/notes/${noteId}`, { method: "DELETE" })
    if (r.status !== 200) { setStatus("error"); setErr(r.body.error || "Couldn't delete."); return }
    api.drop(noteId)
    props.onRemoved?.()
  }

  const label = status === "saving" ? "Saving" : status === "saved" ? "Saved" : ""
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
      <span style={{ fontSize: TYPE.secondary, fontWeight: 700, color: "#2E4260" }}>
        You{props.note ? <span className={look.muted} style={{ fontWeight: 400 }}> · {stamp(props.note)}</span> : null}
      </span>
      <textarea className={look.input} rows={3} value={text} autoFocus={props.autoFocus}
        aria-label="Your note" placeholder="Type a note. It saves as you type."
        onChange={(e) => change(e.target.value)} />
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        {label && <span className={status === "saved" ? look.saved : look.muted} role="status" style={{ fontSize: TYPE.secondary }}>{label}</span>}
        {err && <span className={look.warn} role="alert" style={{ fontSize: TYPE.secondary }}>{err}</span>}
        <button type="button" className={look.link} style={{ marginLeft: "auto", minHeight: 0 }} onClick={() => void remove()}>Delete</button>
      </div>
    </div>
  )
}
