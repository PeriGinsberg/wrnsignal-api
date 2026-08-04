"use client"

// One application, on its own page.
//
// Replaces the accordion that expanded inside a tracker row. That layout had
// two structural problems: the list reflowed under the pointer every time
// something opened, and the detail could never grow past what fits inside a
// table row, so a fourteen-field editor was crammed into a two-column grid with
// nowhere for interviews, notes or the job description to live properly.
//
// ORDER IS THE ARGUMENT, same lesson as the contact record: context first, then
// the one thing to do, then the reference material behind drawers.
//
//   1  who and where, with the status
//   2  the action hero, and ONLY when there is a real action. A job waiting on
//      the company renders nothing here rather than an empty box
//   3  the two facts: status (changeable) and the SIGNAL score
//   4  interviews, nested where they belong
//   5  what your coach said, if anyone did
//   6  drawers: the details editor, the job description, notes, close out
//
// CUT: interest stars (the build plan cuts them), and the "date posted" field.
// NOT BUILT: the networking section from the mockup ("your network at Globex").
// It needs an application-to-company link the schema does not have; that is the
// Phase B merge, and guessing at it by matching company names would be inventing
// the thing the merge is supposed to define.

import { use, useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  LIGHT as S, action as actionStyle, status as statusStyle,
  surfaceCard, tileStructural,
} from "../../../../lib/theme/surfaces"
import {
  InterviewIcon, JobDescriptionIcon, NotesIcon, AccountIcon, SignOutIcon, HistoryIcon,
} from "../../../../components/icons"
import { authFetch } from "../../network/authFetch"
import { daysUntil, formatLong, formatShort, parseLocalDate } from "../../../../lib/localDate"
import { Collapsible } from "../../network/contacts/[contactId]/Collapsible"
import { ClientJobNotes } from "../ClientJobNotes"
import { openInSignal } from "../openInSignal"
import { JobHistory } from "../JobHistory"
import { Field, Select, control, areaControl, formGrid } from "../controls"
import {
  APP_LOCATIONS, STATUS_LABELS, statusLabel, statusMeaning,
  interviewStageLabel, interviewStatusLabel, interviewStatusMeaning,
  INTERVIEW_STAGES, INTERVIEW_STATUSES,
} from "../vocab"
import { needOf, daysSinceApplied, FOLLOW_UP_AFTER_DAYS } from "../applicationOrder"
import { APP_STATUSES } from "../../../_lib/applicationStatuses"

type App = {
  id: string
  company_name: string
  job_title: string
  location: string | null
  job_url: string | null
  application_location: string | null
  application_status: string
  applied_date: string | null
  created_at: string
  notes: string | null
  cover_letter_submitted: boolean | null
  referral: boolean | null
  signal_score: number | null
  signal_decision: string | null
  signal_run_at: string | null
  jobfit_run_id: string | null
  job_description: string | null
  persona_id: string | null
  persona_name: string | null
  coach_annotations?: Annotation[]
}

type Annotation = { id: string; note: string; priority: string | null; created_at: string }

type Interview = {
  id: string
  application_id: string
  interview_stage: string
  interview_date: string | null
  status: string
  interviewer_names: string | null
  notes: string | null
  thank_you_sent: boolean | null
}

// All three go through localDate, which parses a bare "2026-08-07" as LOCAL
// midnight rather than UTC. See lib/localDate.ts for the day-early bug.
const longDate = (d: string | null) => formatLong(d)
const shortDate = (d: string | null) => formatShort(d)

function countdown(d: string): string {
  const days = daysUntil(d) ?? 0
  if (days === 0) return "Today"
  if (days === 1) return "Tomorrow"
  return `In ${days} days`
}

const STATUS_OPTIONS = APP_STATUSES.map((v) => ({ value: v, label: STATUS_LABELS[v] ?? v }))
const STAGE_OPTIONS = INTERVIEW_STAGES.map((v) => ({ value: v, label: interviewStageLabel(v) }))
const IV_STATUS_OPTIONS = INTERVIEW_STATUSES.map((v) => ({ value: v, label: interviewStatusLabel(v) }))

export default function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ applicationId: string }>
}) {
  const { applicationId } = use(params)
  const router = useRouter()

  const [app, setApp] = useState<App | null>(null)
  const [interviews, setInterviews] = useState<Interview[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setErr(null)
    // There is no GET /api/applications/[id]; the list endpoint is the only
    // read, so the row is picked out of it. One extra payload on a page that
    // is not hot, in exchange for not adding an endpoint that would duplicate
    // the list's coach-annotation enrichment.
    const [aRes, iRes] = await Promise.allSettled([
      authFetch("/api/applications"),
      authFetch("/api/interviews"),
    ])
    if (aRes.status === "fulfilled" && aRes.value.ok) {
      const j = await aRes.value.json().catch(() => null)
      const found = (j?.applications || []).find((x: App) => x.id === applicationId)
      if (found) setApp(found)
      else setNotFound(true)
    } else {
      setErr("We couldn't load this job. Refresh to try again.")
    }
    if (iRes.status === "fulfilled" && iRes.value.ok) {
      const j = await iRes.value.json().catch(() => null)
      setInterviews((j?.interviews || []).filter((iv: Interview) => iv.application_id === applicationId))
    }
    setLoading(false)
  }, [applicationId])

  useEffect(() => { void load() }, [load])

  const nextInterview = useMemo(() => {
    const soonestFirst = (a: Interview, b: Interview) =>
      (parseLocalDate(a.interview_date)?.getTime() ?? 0) - (parseLocalDate(b.interview_date)?.getTime() ?? 0)
    return interviews
      .filter((iv) => (daysUntil(iv.interview_date) ?? -1) >= 0)
      .sort(soonestFirst)[0] ?? null
  }, [interviews])

  async function patch(body: Partial<App>) {
    if (!app) return
    const optimistic = { ...app, ...body }
    setApp(optimistic)
    const res = await authFetch(`/api/applications/${app.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      setErr("That change didn't save.")
      void load()
    }
  }

  if (loading) return <p style={{ color: S.text.muted, fontSize: 14.5 }}>Loading…</p>

  if (notFound || !app) {
    return (
      <main style={{ maxWidth: 1080 }}>
        <a href="/dashboard/tracker" style={backLink}>← Back to your applications</a>
        <p style={{ color: S.text.secondary, fontSize: 16, marginTop: 24 }}>
          We couldn&apos;t find that job. It may have been removed.
        </p>
      </main>
    )
  }

  const meaning = statusMeaning(app.application_status)
  const st = statusStyle(S, meaning)
  const need = needOf(app, nextInterview?.interview_date ?? null)
  const quietDays = daysSinceApplied(app)
  const annotations = app.coach_annotations ?? []

  return (
    <main style={{ maxWidth: 1080 }}>
      <a href="/dashboard/tracker" style={backLink}>← Back to your applications</a>

      {err && (
        <div
          style={{
            margin: "14px 0 0", padding: "12px 16px", borderRadius: 12,
            background: S.meaning.error.fill, color: S.meaning.error.ink, fontSize: 14, fontWeight: 700,
          }}
        >
          {err}
        </div>
      )}

      {/* 1 — who and where */}
      <header style={{ display: "flex", alignItems: "center", gap: 18, margin: "18px 0 4px", flexWrap: "wrap" }}>
        <span
          aria-hidden
          style={{
            ...tileStructural(S), width: 56, height: 56, borderRadius: 14, flexShrink: 0,
            display: "grid", placeItems: "center", fontSize: 17, fontWeight: 800, letterSpacing: 0.5,
          }}
        >
          {(app.company_name || "?").trim().slice(0, 2).toUpperCase()}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.5, color: S.text.primary, margin: 0 }}>
            {app.job_title}
          </h1>
          <p style={{ color: S.text.muted, fontSize: 15, margin: "4px 0 0" }}>
            {[app.company_name, app.location, app.applied_date ? `applied ${shortDate(app.applied_date)}` : null]
              .filter(Boolean).join(" · ")}
          </p>
        </div>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <span style={st.dot} />
          <span style={{ ...st.text, fontSize: 16 }}>{statusLabel(app.application_status)}</span>
        </span>
      </header>

      {/* 2 — the action, and only when there is one */}
      {need === "prep" && nextInterview && (
        <section
          style={{
            background: S.hero.background, border: `2px solid ${S.meaning.attention.accent}`,
            borderRadius: 16, padding: "22px 24px", marginTop: 18,
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <span
                aria-hidden
                style={{
                  width: 46, height: 46, borderRadius: 13, background: "rgba(255,255,255,0.10)",
                  display: "grid", placeItems: "center", flexShrink: 0,
                }}
              >
                <InterviewIcon size={25} />
              </span>
              <div>
                <div style={{ color: S.hero.ink, fontSize: 19, fontWeight: 800 }}>
                  {interviewStageLabel(nextInterview.interview_stage)}
                </div>
                <div style={{ color: S.hero.muted, fontSize: 14, marginTop: 3 }}>
                  {longDate(nextInterview.interview_date)}
                  {nextInterview.interviewer_names ? ` · with ${nextInterview.interviewer_names}` : ""}
                </div>
              </div>
            </div>
            <div style={{ color: S.hero.accent, fontSize: 17, fontWeight: 800 }}>
              {countdown(nextInterview.interview_date!)}
            </div>
          </div>
          <p style={{ color: S.hero.muted, fontSize: 14.5, lineHeight: "21px", margin: "16px 0 0" }}>
            Reread the job description below, and look at what SIGNAL said made you a match. Those
            are the things worth being able to say out loud.
          </p>
        </section>
      )}

      {need === "apply" && (
        <ActionStrip
          title="You saved this one but haven't applied."
          body="Nothing happens until it goes out. If it's still a yes, send it."
          cta={app.job_url ? { label: "Open the posting →", href: app.job_url } : null}
          secondary={{ label: "Mark as applied", onClick: () => patch({ application_status: "applied", applied_date: new Date().toISOString().slice(0, 10) }) }}
        />
      )}

      {need === "followup" && (
        <ActionStrip
          title={`It's been ${quietDays} days with no word.`}
          body={`After about ${FOLLOW_UP_AFTER_DAYS} days it's fair to check in. A short, polite note to the recruiter or hiring manager is normal and it works.`}
          cta={null}
          secondary={null}
        />
      )}

      {/* 3 — the two facts */}
      <div style={{ display: "flex", gap: 12, marginTop: 18, flexWrap: "wrap" }}>
        <div style={{ ...surfaceCard(S), borderRadius: 14, padding: "16px 20px", flex: "1 1 260px" }}>
          <div style={factLabel}>Status</div>
          <Select
            value={app.application_status}
            options={STATUS_OPTIONS}
            ariaLabel="Status"
            onChange={(v) => patch({ application_status: v })}
          />
        </div>
        {/* The score, and the way back to the reasoning behind it.
            A number with no route to its explanation is the least useful thing
            on this page: "71, Review" tells a student nothing they can act on,
            while the analysis behind it is the WHY and RISK bullets they are
            supposed to write their application from. */}
        <div style={{ ...surfaceCard(S), borderRadius: 14, padding: "16px 20px", flex: "1 1 260px" }}>
          <div style={factLabel}>How you scored</div>
          {app.signal_score != null ? (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                <span style={{ fontSize: 30, fontWeight: 800, color: S.text.primary, fontVariantNumeric: "tabular-nums" }}>
                  {app.signal_score}
                </span>
                <span style={{ fontSize: 14.5, color: S.text.muted }}>{app.signal_decision}</span>
              </div>
              {app.jobfit_run_id ? (
                <button
                  onClick={() => void openInSignal(app.jobfit_run_id!)}
                  style={{
                    background: "none", border: "none", padding: "10px 0 0",
                    color: S.action.quietInk, fontSize: 14, fontWeight: 700,
                    cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  See the full analysis →
                </button>
              ) : (
                // Roughly a third of scored applications carry a score with no
                // run behind it: a coach-sourced job copies the number across,
                // and rows that predate the FK never had one. Saying so beats a
                // dead link or a silently missing control.
                <p style={{ fontSize: 13.5, color: S.text.dim, margin: "10px 0 0", lineHeight: "19px" }}>
                  The full analysis isn&apos;t saved for this one.
                </p>
              )}
            </>
          ) : (
            <div style={{ fontSize: 14.5, color: S.text.muted, paddingTop: 6 }}>
              This one hasn&apos;t been scored.
            </div>
          )}
        </div>
      </div>

      {/* 4 — interviews, where they belong */}
      <InterviewsSection
        applicationId={app.id}
        interviews={interviews}
        onChanged={load}
      />

      {/* 5 — what a coach said. Teal, so it never reads as the student's own note. */}
      {annotations.length > 0 && (
        <section
          style={{
            marginTop: 14, padding: "18px 22px", borderRadius: 14,
            background: S.meaning.replied.fill, borderLeft: `3px solid ${S.meaning.replied.accent}`,
          }}
        >
          <div
            style={{
              fontSize: 12, fontWeight: 800, letterSpacing: 1.2, textTransform: "uppercase",
              color: S.meaning.replied.ink, marginBottom: 12,
            }}
          >
            From your coach
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {annotations.map((ann) => (
              <div key={ann.id}>
                <div style={{ fontSize: 14.5, color: S.text.secondary, lineHeight: "21px", whiteSpace: "pre-wrap" }}>
                  {ann.note}
                </div>
                <div style={{ fontSize: 12.5, color: S.text.dim, marginTop: 4 }}>{shortDate(ann.created_at)}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 6 — reference, behind drawers */}
      <div style={{ marginTop: 14 }}>
        <Collapsible
          title="Details"
          testId="job-details"
          icon={<AccountIcon size={20} />}
          summary={[app.location, app.application_location, app.job_url ? "has a link" : null]
            .filter(Boolean).join(" · ") || "Nothing filled in yet"}
        >
          <DetailsEditor app={app} onSave={patch} />
        </Collapsible>

        {/* Directly under Details, and above the reference material, because
            "what has happened here" is closer to context than to reference.
            Same position it holds on the contact record. */}
        <Collapsible
          title="History"
          testId="job-history"
          icon={<HistoryIcon size={20} />}
          summary="Everything that's happened on this job"
        >
          <JobHistory applicationId={app.id} />
        </Collapsible>

        <Collapsible
          title="Job description"
          testId="job-description"
          icon={<JobDescriptionIcon size={20} />}
          summary={app.job_description ? "Saved for you" : "Not saved for this one"}
        >
          {app.job_description ? (
            <>
              <p style={{ fontSize: 14, color: S.text.muted, margin: "0 0 14px", lineHeight: "21px" }}>
                Saved from when this job was scored. Companies often pull a posting down right after
                they invite you to interview, which is exactly when you need to reread it.
              </p>
              <div
                style={{
                  fontSize: 14, color: S.text.secondary, lineHeight: "22px",
                  whiteSpace: "pre-wrap", wordBreak: "break-word",
                  maxHeight: 420, overflowY: "auto",
                  background: S.well, borderRadius: 10, padding: "14px 16px",
                }}
              >
                {app.job_description}
              </div>
            </>
          ) : (
            <p style={{ fontSize: 14, color: S.text.muted, margin: 0 }}>
              We only keep the description for jobs scored through SIGNAL. This one was added by hand.
            </p>
          )}
        </Collapsible>

        <Collapsible
          title="Notes"
          testId="job-notes"
          icon={<NotesIcon size={20} />}
          summary={app.jobfit_run_id ? "Yours, and your coach's" : "Available once scored"}
        >
          <ClientJobNotes applicationId={app.id} jobfitRunId={app.jobfit_run_id} />
        </Collapsible>

        <Collapsible
          title="Close out this job"
          testId="job-remove"
          icon={<SignOutIcon size={20} />}
          summary="Remove it and everything on it"
        >
          <CloseOut
            onDelete={async () => {
              const res = await authFetch(`/api/applications/${app.id}`, { method: "DELETE" })
              if (res.ok) router.push("/dashboard/tracker")
              else setErr("We couldn't remove that job.")
            }}
          />
        </Collapsible>
      </div>
    </main>
  )
}

/**
 * A one-line prompt with the reason underneath. Not the navy hero: only a dated
 * interview earns that, because only a dated interview is time-bound.
 */
function ActionStrip({
  title, body, cta, secondary,
}: {
  title: string
  body: string
  cta: { label: string; href: string } | null
  secondary: { label: string; onClick: () => void } | null
}) {
  return (
    <section
      style={{
        marginTop: 18, padding: "18px 22px", borderRadius: 14,
        background: S.card, border: `1px solid ${S.borderSoft}`,
        borderLeft: `3px solid ${S.meaning.attention.accent}`, boxShadow: S.shadow.card,
      }}
    >
      <div style={{ fontSize: 16, fontWeight: 800, color: S.text.primary }}>{title}</div>
      <p style={{ fontSize: 14.5, color: S.text.muted, lineHeight: "21px", margin: "6px 0 0" }}>{body}</p>
      {(cta || secondary) && (
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 16, flexWrap: "wrap" }}>
          {cta && (
            <a
              href={cta.href} target="_blank" rel="noopener noreferrer"
              style={{ ...actionStyle(S, "primary"), textDecoration: "none", borderRadius: 10, padding: "10px 18px", fontSize: 14 }}
            >
              {cta.label}
            </a>
          )}
          {secondary && (
            <button
              onClick={secondary.onClick}
              style={{
                background: "none", border: "none", color: S.action.quietInk,
                fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
              }}
            >
              {secondary.label}
            </button>
          )}
        </div>
      )}
    </section>
  )
}

function InterviewsSection({
  applicationId, interviews, onChanged,
}: {
  applicationId: string
  interviews: Interview[]
  onChanged: () => void
}) {
  const [adding, setAdding] = useState(false)
  const [stage, setStage] = useState<string>("phone")
  const [date, setDate] = useState("")
  const [who, setWho] = useState("")
  const [saving, setSaving] = useState(false)

  async function create() {
    if (saving) return
    setSaving(true)
    await authFetch("/api/interviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        application_id: applicationId,
        interview_stage: stage,
        interview_date: date || null,
        interviewer_names: who.trim() || null,
        status: date ? "scheduled" : "not_scheduled",
      }),
    })
    setSaving(false)
    setAdding(false); setDate(""); setWho(""); setStage("phone")
    onChanged()
  }

  return (
    <section style={{ ...surfaceCard(S), borderRadius: 14, padding: "18px 22px", marginTop: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <span
          style={{
            fontSize: 12, fontWeight: 800, letterSpacing: 1.4,
            textTransform: "uppercase", color: S.text.muted,
          }}
        >
          Interviews
        </span>
        <button
          onClick={() => setAdding((v) => !v)}
          style={{
            background: "none", border: "none", color: S.action.quietInk,
            fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
          }}
        >
          {adding ? "Cancel" : "+ Add an interview"}
        </button>
      </div>

      {interviews.length === 0 && !adding && (
        <p style={{ fontSize: 14.5, color: S.text.muted, margin: "12px 0 0" }}>
          None yet. Add one when you get the invite and it'll show up on your dashboard with a
          countdown.
        </p>
      )}

      {interviews.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
          {interviews.map((iv) => {
            const ivst = statusStyle(S, interviewStatusMeaning(iv.status))
            return (
              <div
                key={iv.id}
                style={{
                  display: "flex", alignItems: "center", gap: 14,
                  padding: "12px 14px", borderRadius: 12, background: S.well,
                }}
              >
                <InterviewIcon size={22} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 14.5, fontWeight: 700, color: S.text.primary }}>
                    {interviewStageLabel(iv.interview_stage)}
                  </span>
                  <span style={{ display: "block", fontSize: 13, color: S.text.muted, marginTop: 2 }}>
                    {[longDate(iv.interview_date) || "No date yet", iv.interviewer_names].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <span style={ivst.dot} />
                  <span style={{ ...ivst.text, fontSize: 13.5, whiteSpace: "nowrap" }}>
                    {interviewStatusLabel(iv.status)}
                  </span>
                </span>
              </div>
            )
          })}
        </div>
      )}

      {adding && (
        <div style={{ marginTop: 16 }}>
          <div style={formGrid}>
            <Field label="What kind">
              <Select value={stage} options={STAGE_OPTIONS} onChange={setStage} ariaLabel="What kind" />
            </Field>
            <Field label="When">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={control} aria-label="When" />
            </Field>
            <Field label="Who you're meeting">
              <input value={who} onChange={(e) => setWho(e.target.value)} style={control} placeholder="Optional" aria-label="Who you're meeting" />
            </Field>
          </div>
          <button
            onClick={create}
            disabled={saving}
            style={{
              ...actionStyle(S, "primary"), marginTop: 14,
              borderRadius: 10, padding: "10px 18px", fontSize: 14, fontFamily: "inherit",
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? "Adding…" : "Add it"}
          </button>
        </div>
      )}
    </section>
  )
}

/**
 * Every editable field. Saves on blur, one field at a time, so there is no Save
 * button to forget and no draft to lose. `patch` is optimistic and reloads on
 * failure, which is what makes per-field saving safe here.
 */
function DetailsEditor({ app, onSave }: { app: App; onSave: (b: Partial<App>) => void }) {
  const commit = (key: keyof App, value: string | null) => {
    if ((app[key] ?? null) === (value ?? null)) return
    onSave({ [key]: value } as Partial<App>)
  }
  return (
    <div style={formGrid}>
      <Field label="Company">
        <input
          defaultValue={app.company_name || ""} maxLength={200} style={control} aria-label="Company"
          onBlur={(e) => commit("company_name", e.target.value.trim() || app.company_name)}
        />
      </Field>
      <Field label="Role">
        <input
          defaultValue={app.job_title || ""} maxLength={200} style={control} aria-label="Role"
          onBlur={(e) => commit("job_title", e.target.value.trim() || app.job_title)}
        />
      </Field>
      <Field label="Location">
        <input
          defaultValue={app.location || ""} style={control} aria-label="Location"
          onBlur={(e) => commit("location", e.target.value.trim() || null)}
        />
      </Field>
      <Field label="Date you applied">
        <input
          type="date" defaultValue={app.applied_date || ""} style={control} aria-label="Date you applied"
          onBlur={(e) => commit("applied_date", e.target.value || null)}
        />
      </Field>
      <Field label="Link to the posting">
        <input
          defaultValue={app.job_url || ""} style={control} placeholder="https://" aria-label="Link to the posting"
          onBlur={(e) => commit("job_url", e.target.value.trim() || null)}
        />
      </Field>
      <Field label="Where you found it">
        <Select
          value={app.application_location || APP_LOCATIONS[0]}
          options={APP_LOCATIONS}
          ariaLabel="Where you found it"
          onChange={(v) => onSave({ application_location: v })}
        />
      </Field>
      <Field label="Sent a cover letter">
        <Select
          value={app.cover_letter_submitted ? "yes" : "no"}
          options={[{ value: "no", label: "No" }, { value: "yes", label: "Yes" }]}
          ariaLabel="Sent a cover letter"
          onChange={(v) => onSave({ cover_letter_submitted: v === "yes" })}
        />
      </Field>
      <Field label="Had a referral">
        <Select
          value={app.referral ? "yes" : "no"}
          options={[{ value: "no", label: "No" }, { value: "yes", label: "Yes" }]}
          ariaLabel="Had a referral"
          onChange={(v) => onSave({ referral: v === "yes" })}
        />
      </Field>
      <Field label="Your own notes" span={2}>
        <textarea
          defaultValue={app.notes || ""} style={areaControl} aria-label="Your own notes"
          placeholder="Anything you want to remember about this one"
          onBlur={(e) => commit("notes", e.target.value.trim() || null)}
        />
      </Field>
    </div>
  )
}

/** Two taps to delete, and the second one says what goes. */
function CloseOut({ onDelete }: { onDelete: () => Promise<void> }) {
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!armed) {
    return (
      <>
        <p style={{ fontSize: 14, color: S.text.muted, margin: "0 0 14px", lineHeight: "21px" }}>
          Removing a job takes its interviews and notes with it. If you just didn&apos;t get it, set
          the status to No offer instead and keep the record.
        </p>
        <button
          onClick={() => setArmed(true)}
          style={{
            background: "none", border: `1px solid ${S.border}`, color: S.meaning.error.ink,
            fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
            borderRadius: 10, padding: "9px 16px",
          }}
        >
          Remove this job
        </button>
      </>
    )
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
      <span style={{ fontSize: 14.5, color: S.text.primary, fontWeight: 700 }}>
        Remove it for good?
      </span>
      <button
        onClick={async () => { setBusy(true); await onDelete(); setBusy(false) }}
        disabled={busy}
        style={{
          background: S.meaning.error.ink, border: "none", color: "#FFFFFF",
          fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
          borderRadius: 10, padding: "9px 16px", opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? "Removing…" : "Yes, remove it"}
      </button>
      <button
        onClick={() => setArmed(false)}
        style={{
          background: "none", border: "none", color: S.action.quietInk,
          fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
        }}
      >
        Keep it
      </button>
    </div>
  )
}

const backLink: React.CSSProperties = {
  color: S.action.quietInk, fontSize: 14, fontWeight: 700, textDecoration: "none",
}
const factLabel: React.CSSProperties = {
  fontSize: 12, fontWeight: 800, letterSpacing: 1.2, textTransform: "uppercase",
  color: S.text.muted, marginBottom: 10,
}
