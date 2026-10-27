"use client"

// The supporter area. Read only, except for the one thing a supporter can do:
// suggest a job. A suggestion waits for the client, who adds it to their
// tracker or passes on it; until then the supporter can edit or delete it.
//
// Everything on this page comes from /api/supporter/*, which serves explicit
// columns only. Nothing here can reach the client's notes or anything a coach
// wrote, because the routes never select it.

import { Suspense, useCallback, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { LIGHT as S, action, status as statusStyle } from "../../../lib/theme/surfaces"
import { formatShort } from "../../../lib/localDate"
import { statusLabel, statusMeaning, interviewStageLabel, decisionMeaning } from "../tracker/vocab"
import { supporterFetch } from "./supporterFetch"

type Supporting = { supporter_id: string; client_profile_id: string; client_first_name: string; display_name: string }
type Interview = { interview_stage: string; interview_date: string | null }
type App = {
  id: string
  company_name: string
  job_title: string
  location: string | null
  job_url: string | null
  application_status: string
  applied_date: string | null
  signal_decision: string | null
  signal_score: number | null
  added_by_role: string
  added_by_name: string | null
  interviews: Interview[]
  has_jobfit: boolean
  has_cover_letter: boolean
  created_at: string
}
type Suggestion = {
  id: string
  company_name: string
  job_title: string
  job_url: string
  location: string
  note: string
  status: "pending" | "accepted" | "dismissed"
  added_by_name: string | null
  mine: boolean
  editable: boolean
  created_at: string
}
type Tracker = { client: { first_name: string }; applications: App[]; suggestions: Suggestion[] }

const card: React.CSSProperties = {
  background: S.card, border: `1px solid ${S.borderSoft}`, borderRadius: 14, boxShadow: S.shadow.card, padding: "16px 18px",
}
const label: React.CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: 0.8, textTransform: "uppercase", color: S.text.muted }
const input: React.CSSProperties = {
  width: "100%", background: S.well, border: `1px solid ${S.border}`, borderRadius: 10, padding: "10px 12px",
  fontSize: 14, color: S.text.primary, fontFamily: "inherit", boxSizing: "border-box", marginTop: 6,
}

export default function SupporterPage() {
  return (
    <Suspense fallback={null}>
      <SupporterHome />
    </Suspense>
  )
}

function SupporterHome() {
  const router = useRouter()
  const params = useSearchParams()
  const [supporting, setSupporting] = useState<Supporting[] | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    void supporterFetch("/api/supporter/me").then((j) => {
      if (j.ok) setSupporting(j.supporting)
      else setError(j.error)
    })
  }, [])

  if (error) return <p style={{ color: S.meaning.error.ink, fontWeight: 700 }}>{error}</p>
  if (!supporting) return <p style={{ color: S.text.muted }}>Loading…</p>
  if (supporting.length === 0) {
    return (
      <div style={{ ...card, maxWidth: 520 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>You are not supporting anyone right now</h1>
        <p style={{ color: S.text.secondary, fontSize: 15, lineHeight: "23px" }}>
          If someone invited you, open the link in their invite email. If you were removed as a supporter, ask them to invite
          you again.
        </p>
      </div>
    )
  }

  const chosen = supporting.find((s) => s.client_profile_id === params.get("client")) ?? supporting[0]
  return (
    <>
      {supporting.length > 1 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          {supporting.map((s) => {
            const on = s.client_profile_id === chosen.client_profile_id
            return (
              <button
                key={s.client_profile_id}
                onClick={() => router.replace(`/dashboard/supporter?client=${encodeURIComponent(s.client_profile_id)}`)}
                style={{
                  background: on ? S.text.primary : S.card, color: on ? "#FFFFFF" : S.text.secondary,
                  border: `1px solid ${on ? S.text.primary : S.borderSoft}`, borderRadius: 12, padding: "8px 16px",
                  fontSize: 14, fontWeight: 800, cursor: "pointer", fontFamily: "inherit",
                }}
              >
                {s.client_first_name}
              </button>
            )
          })}
        </div>
      )}
      <ClientView key={chosen.client_profile_id} clientId={chosen.client_profile_id} />
    </>
  )
}

function ClientView({ clientId }: { clientId: string }) {
  const [tab, setTab] = useState<"tracker" | "profile">("tracker")
  const [data, setData] = useState<Tracker | null>(null)
  const [error, setError] = useState("")
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    const j = await supporterFetch(`/api/supporter/clients/${clientId}/tracker`)
    if (j.ok) { setData(j); setError("") } else setError(j.error)
  }, [clientId])
  useEffect(() => { void load() }, [load])

  if (error) return <p style={{ color: S.meaning.error.ink, fontWeight: 700 }}>{error}</p>
  if (!data) return <p style={{ color: S.text.muted }}>Loading…</p>
  const name = data.client.first_name

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: -0.5, margin: 0 }}>{name}&apos;s job search</h1>
          <p style={{ color: S.text.muted, fontSize: 15, margin: "6px 0 0" }}>
            You can see {name}&apos;s tracker and suggest jobs. {name} decides what goes on the tracker.
          </p>
        </div>
        <button
          onClick={() => setAdding((v) => !v)}
          style={{ ...action(S, "primary"), borderRadius: 12, padding: "12px 20px", fontSize: 15, fontFamily: "inherit" }}
        >
          + Suggest a job
        </button>
      </div>

      {adding && (
        <SuggestionForm
          clientId={clientId}
          onDone={() => { setAdding(false); void load() }}
          onCancel={() => setAdding(false)}
        />
      )}

      <div style={{ display: "flex", gap: 8, margin: "22px 0 16px" }}>
        {(["tracker", "profile"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              background: tab === t ? S.text.primary : S.card, color: tab === t ? "#FFFFFF" : S.text.secondary,
              border: `1px solid ${tab === t ? S.text.primary : S.borderSoft}`, borderRadius: 12, padding: "9px 20px",
              fontSize: 15, fontWeight: 800, cursor: "pointer", fontFamily: "inherit",
            }}
          >
            {t === "tracker" ? "Job Tracker" : "Profile and resume"}
          </button>
        ))}
      </div>

      {tab === "tracker" ? (
        <>
          <Suggestions clientId={clientId} name={name} suggestions={data.suggestions} onChanged={() => void load()} />
          <h2 style={{ fontSize: 18, fontWeight: 800, margin: "24px 0 10px" }}>On {name}&apos;s tracker</h2>
          {data.applications.length === 0 ? (
            <p style={{ color: S.text.muted, fontSize: 14.5 }}>Nothing on the tracker yet.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {data.applications.map((a) => <AppRow key={a.id} clientId={clientId} app={a} />)}
            </div>
          )}
        </>
      ) : (
        <ProfileView clientId={clientId} />
      )}
    </>
  )
}

function Tag({ text, meaning }: { text: string; meaning: Parameters<typeof statusStyle>[1] }) {
  const st = statusStyle(S, meaning)
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
      <span style={st.dot} />
      <span style={{ ...st.text, fontSize: 13 }}>{text}</span>
    </span>
  )
}

function Suggestions({ clientId, name, suggestions, onChanged }: {
  clientId: string; name: string; suggestions: Suggestion[]; onChanged: () => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [err, setErr] = useState("")
  if (suggestions.length === 0) return null

  async function remove(id: string) {
    const j = await supporterFetch(`/api/supporter/clients/${clientId}/suggestions/${id}`, { method: "DELETE" })
    if (j.ok) onChanged()
    else setErr(j.error)
  }

  return (
    <section>
      <h2 style={{ fontSize: 18, fontWeight: 800, margin: "0 0 10px" }}>Suggested jobs</h2>
      {err && <p style={{ color: S.meaning.error.ink, fontWeight: 700, fontSize: 14 }}>{err}</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {suggestions.map((s) =>
          editing === s.id ? (
            <SuggestionForm
              key={s.id}
              clientId={clientId}
              existing={s}
              onDone={() => { setEditing(null); onChanged() }}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <div key={s.id} style={{ ...card, display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 15.5, fontWeight: 800 }}>
                  {s.job_title} <span style={{ color: S.text.muted, fontWeight: 600 }}>· {s.company_name}</span>
                </div>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 6 }}>
                  {s.status === "pending" && <Tag text={`Waiting for ${name}`} meaning="attention" />}
                  {s.status === "accepted" && <Tag text="Added to the tracker" meaning="done" />}
                  {s.status === "dismissed" && <Tag text="Not added" meaning="dormant" />}
                  <span style={{ fontSize: 13, color: S.text.muted }}>
                    {s.mine ? "Added by you" : `Added by ${s.added_by_name ?? "another supporter"}`}
                  </span>
                </div>
                {s.note && <p style={{ fontSize: 13.5, color: S.text.secondary, margin: "8px 0 0" }}>{s.note}</p>}
                {s.job_url && (
                  <a href={s.job_url} target="_blank" rel="noreferrer" style={{ fontSize: 13.5, color: S.action.quietInk, fontWeight: 700 }}>
                    Job posting
                  </a>
                )}
              </div>
              {s.editable && (
                <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <button onClick={() => setEditing(s.id)} style={{ ...action(S, "optional"), borderRadius: 10, padding: "7px 12px", fontSize: 13, fontFamily: "inherit" }}>
                    Edit
                  </button>
                  <button onClick={() => void remove(s.id)} style={{ ...action(S, "optional"), borderRadius: 10, padding: "7px 12px", fontSize: 13, fontFamily: "inherit" }}>
                    Delete
                  </button>
                </div>
              )}
            </div>
          ),
        )}
      </div>
    </section>
  )
}

function SuggestionForm({ clientId, existing, onDone, onCancel }: {
  clientId: string; existing?: Suggestion; onDone: () => void; onCancel: () => void
}) {
  const [f, setF] = useState({
    company_name: existing?.company_name ?? "",
    job_title: existing?.job_title ?? "",
    job_url: existing?.job_url ?? "",
    location: existing?.location ?? "",
    note: existing?.note ?? "",
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState("")

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const j = existing
      ? await supporterFetch(`/api/supporter/clients/${clientId}/suggestions/${existing.id}`, { method: "PATCH", body: JSON.stringify(f) })
      : await supporterFetch(`/api/supporter/clients/${clientId}/suggestions`, { method: "POST", body: JSON.stringify(f) })
    setSaving(false)
    if (j.ok) onDone()
    else setErr(j.error)
  }

  const field = (key: keyof typeof f, text: string, required = false) => (
    <label style={{ display: "block", marginTop: 12 }}>
      <span style={label}>{text}{required ? "" : " (optional)"}</span>
      {key === "note" ? (
        <textarea value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })} rows={3} style={{ ...input, resize: "vertical" }} />
      ) : (
        <input value={f[key]} required={required} onChange={(e) => setF({ ...f, [key]: e.target.value })} style={input} />
      )}
    </label>
  )

  return (
    <form onSubmit={save} style={{ ...card, marginTop: 16 }}>
      <div style={{ fontSize: 16, fontWeight: 800 }}>{existing ? "Edit your suggestion" : "Suggest a job"}</div>
      {field("job_title", "Job title", true)}
      {field("company_name", "Company", true)}
      {field("job_url", "Link to the posting")}
      {field("location", "Location")}
      {field("note", "Why it might be a fit")}
      {err && <p style={{ color: S.meaning.error.ink, fontWeight: 700, fontSize: 14 }}>{err}</p>}
      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <button type="submit" disabled={saving} style={{ ...action(S, "primary"), borderRadius: 10, padding: "10px 18px", fontSize: 14, fontFamily: "inherit", opacity: saving ? 0.55 : 1 }}>
          {saving ? "Saving…" : existing ? "Save" : "Send suggestion"}
        </button>
        <button type="button" onClick={onCancel} style={{ ...action(S, "optional"), borderRadius: 10, padding: "10px 18px", fontSize: 14, fontFamily: "inherit" }}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function AppRow({ clientId, app: a }: { clientId: string; app: App }) {
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<any>(null)

  async function toggle() {
    const next = !open
    setOpen(next)
    if (next && !detail && (a.has_jobfit || a.has_cover_letter)) {
      setDetail(await supporterFetch(`/api/supporter/clients/${clientId}/applications/${a.id}`))
    }
  }

  return (
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15.5, fontWeight: 800 }}>
            {a.job_title} <span style={{ color: S.text.muted, fontWeight: 600 }}>· {a.company_name}</span>
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 6, alignItems: "center" }}>
            <Tag text={statusLabel(a.application_status)} meaning={statusMeaning(a.application_status)} />
            {a.signal_decision && (
              <span style={{ fontSize: 13, color: S.meaning[decisionMeaning(a.signal_decision)].ink, fontWeight: 700 }}>
                {a.signal_decision}{a.signal_score != null ? ` · ${a.signal_score}` : ""}
              </span>
            )}
            {a.added_by_role === "supporter" && (
              <span style={{ fontSize: 13, color: S.text.muted }}>Added by {a.added_by_name ?? "a supporter"}</span>
            )}
            {a.applied_date && <span style={{ fontSize: 13, color: S.text.muted }}>Applied {formatShort(a.applied_date)}</span>}
          </div>
          {a.interviews.length > 0 && (
            <div style={{ fontSize: 13.5, color: S.text.secondary, marginTop: 6 }}>
              {a.interviews
                .map((i) => [interviewStageLabel(i.interview_stage), i.interview_date ? formatShort(i.interview_date) : null].filter(Boolean).join(", "))
                .join(" · ")}
            </div>
          )}
        </div>
        {(a.has_jobfit || a.has_cover_letter) && (
          <button onClick={() => void toggle()} style={{ ...action(S, "optional"), borderRadius: 10, padding: "7px 12px", fontSize: 13, fontFamily: "inherit", alignSelf: "flex-start" }}>
            {open ? "Hide results" : "See results"}
          </button>
        )}
      </div>
      {open && (
        <div style={{ marginTop: 14, borderTop: `1px solid ${S.borderSoft}`, paddingTop: 14 }}>
          {!detail ? (
            <p style={{ color: S.text.muted, fontSize: 14 }}>Loading…</p>
          ) : !detail.ok ? (
            <p style={{ color: S.meaning.error.ink, fontSize: 14, fontWeight: 700 }}>{detail.error}</p>
          ) : (
            <>
              <JobFitView jobfit={detail.jobfit} />
              {detail.cover_letter?.letter && (
                <div style={{ marginTop: 16 }}>
                  <div style={label}>Cover letter</div>
                  <div style={{ fontSize: 14, color: S.text.primary, lineHeight: "21px", whiteSpace: "pre-wrap", marginTop: 6 }}>
                    {detail.cover_letter.letter}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function bullets(...candidates: unknown[]): string[] {
  for (const c of candidates) {
    if (Array.isArray(c) && c.length) {
      return c.map((b: any) => (typeof b === "string" ? b : b?.text ?? b?.label ?? "")).map(String).filter(Boolean)
    }
  }
  return []
}

function JobFitView({ jobfit }: { jobfit: any }) {
  if (!jobfit || typeof jobfit !== "object") return null
  const why = bullets(jobfit.bullets, jobfit.why)
  const risk = bullets(jobfit.risk_flags, jobfit.risk)
  return (
    <div>
      <div style={label}>JobFit</div>
      <div style={{ fontSize: 15, fontWeight: 800, marginTop: 6 }}>
        {jobfit.decision}{typeof jobfit.score === "number" ? ` · ${jobfit.score}` : ""}
      </div>
      {why.length > 0 && (
        <>
          <div style={{ ...label, marginTop: 12 }}>Why it fits</div>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 14, lineHeight: "21px", color: S.text.primary }}>
            {why.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
        </>
      )}
      {risk.length > 0 && (
        <>
          <div style={{ ...label, marginTop: 12 }}>Watch-outs</div>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 14, lineHeight: "21px", color: S.text.secondary }}>
            {risk.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
        </>
      )}
    </div>
  )
}

function ProfileView({ clientId }: { clientId: string }) {
  const [p, setP] = useState<any>(null)
  useEffect(() => {
    void supporterFetch(`/api/supporter/clients/${clientId}/profile`).then(setP)
  }, [clientId])
  if (!p) return <p style={{ color: S.text.muted }}>Loading…</p>
  if (!p.ok) return <p style={{ color: S.meaning.error.ink, fontWeight: 700 }}>{p.error}</p>
  const prof = p.profile
  const rows: [string, string | null][] = [
    ["Target roles", prof.target_roles],
    ["Target locations", prof.target_locations || prof.preferred_locations],
    ["Timeline", prof.timeline],
    ["Looking for", prof.job_type],
  ]
  return (
    <div style={card}>
      {rows.filter(([, v]) => v && String(v).trim()).map(([k, v]) => (
        <div key={k} style={{ marginBottom: 12 }}>
          <div style={label}>{k}</div>
          <div style={{ fontSize: 14.5, marginTop: 4 }}>{String(v)}</div>
        </div>
      ))}
      <div style={label}>Resume</div>
      {prof.resume_text ? (
        <div style={{ fontSize: 14, lineHeight: "21px", whiteSpace: "pre-wrap", marginTop: 6, color: S.text.primary }}>{prof.resume_text}</div>
      ) : (
        <p style={{ fontSize: 14, color: S.text.muted }}>No resume yet.</p>
      )}
    </div>
  )
}
