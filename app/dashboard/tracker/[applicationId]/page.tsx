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
//
// The networking section ("your network at Globex") is BUILT, as of the
// company link in 20260805_application_company_link.sql. It sat unbuilt because
// the schema had no application-to-company edge, and the note here said that
// guessing at it by matching company names would be inventing the thing the
// merge was supposed to define. That still holds and shaped the result: a name
// match only ever SUGGESTS, and the user confirms every link.

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
import {
  composeLocalInstant, daysUntil, formatLong, formatShort, parseLocalDate, splitLocalInstant,
} from "../../../../lib/localDate"
import { Collapsible } from "../../network/contacts/[contactId]/Collapsible"
import { ClientJobNotes } from "../ClientJobNotes"
import { openInSignal } from "../openInSignal"
import { JobHistory } from "../JobHistory"
import { NetworkAtCompany } from "./NetworkAtCompany"
import { Field, Select, control, areaControl, formGrid } from "../controls"
import {
  APP_LOCATIONS, STATUS_LABELS, statusLabel, statusMeaning,
  interviewStageLabel, interviewStatusLabel, interviewStatusMeaning, interviewFormatLabel,
  INTERVIEW_STAGES, INTERVIEW_STATUSES, INTERVIEW_FORMATS,
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
  /** The networking board link. Null until the user confirms one. */
  company_id: string | null
  coach_annotations?: Annotation[]
}

type Annotation = { id: string; note: string; priority: string | null; created_at: string }

type Interview = {
  id: string
  application_id: string
  interview_stage: string
  interview_date: string | null
  /** The instant, when a time was actually given. Null is the normal case. */
  interview_at: string | null
  interview_format: string | null
  status: string
  interviewer_names: string | null
  notes: string | null
  thank_you_sent: boolean | null
  confidence_level: number | null
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

/**
 * "" is a real option and it means UNSET, not a default. Prep Now branches on
 * format and shows both the in-person and the video items when it is null, so
 * an empty format costs a little duplication and a guessed one sends someone
 * to the wrong place.
 */
const FORMAT_OPTIONS = [
  { value: "", label: "Not sure yet" },
  ...INTERVIEW_FORMATS.map((v) => ({ value: v, label: interviewFormatLabel(v) })),
]

/** The clock time, but only when one was actually recorded. */
function timeLabel(iv: { interview_at: string | null }): string | null {
  const d = parseLocalDate(iv.interview_at)
  return d ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : null
}

export default function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ applicationId: string }>
}) {
  const { applicationId } = use(params)
  const router = useRouter()

  const [app, setApp] = useState<App | null>(null)
  const [interviews, setInterviews] = useState<Interview[]>([])
  /** Lives ABOVE the Notes drawer on purpose: the drawer unmounts its children,
   *  so a flag held inside them would vanish exactly when it is needed. */
  const [notesDirty, setNotesDirty] = useState(false)
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
                  {[
                    longDate(nextInterview.interview_date),
                    timeLabel(nextInterview),
                    nextInterview.interviewer_names ? `with ${nextInterview.interviewer_names}` : null,
                  ].filter(Boolean).join(" · ")}
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
          {/* This hero showed an interview with no way into preparing for it —
              the only place in the tracker that named a round and then offered
              nothing to do about it. */}
          <a
            href={`/dashboard/tracker/interviews/${nextInterview.id}`}
            style={{
              ...actionStyle(S, "primary"), textDecoration: "none", display: "inline-block",
              marginTop: 18, borderRadius: 11, padding: "11px 20px", fontSize: 14.5,
            }}
          >
            Prep now →
          </a>
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

      {/* 4 — the networking board link.
          The section this file's header comment said was "NOT BUILT" because
          it "needs an application-to-company link the schema does not have".
          20260805_application_company_link.sql added it, so this is that
          section, and it is the surface that creates the link the contact
          record reads.

          ABOVE INTERVIEWS, not below. It sat under a section that grows without
          bound — every interview on the application, each with its own rows —
          so on any job with real interview history this was pushed off the
          screen entirely. A tester reported its controls missing on a job where
          they were rendering fine; they were just far enough down to be
          invisible. Interviews are a record you go looking for; this is a
          prompt that has to be seen without being sought. */}
      <NetworkAtCompany
        applicationId={app.id}
        companyName={app.company_name}
        jobTitle={app.job_title}
        companyId={app.company_id ?? null}
        onChanged={load}
      />

      {/* 5 — interviews, where they belong */}
      <InterviewsSection
        applicationId={app.id}
        interviews={interviews}
        onChanged={load}
      />

      {/* 6 — what a coach said. Teal, so it never reads as the student's own note. */}
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

      {/* 7 — reference, behind drawers */}
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

        {/* LOCKED OPEN WHILE A NOTE IS HALF-WRITTEN. The drawer unmounts its
            children, and these composers hold their text in local state until
            Save — so collapsing mid-note used to destroy it silently. They
            cannot commit on blur the way an edit-in-place field does, because
            each save CREATES a note and blur would fill the log with fragments.
            So the drawer stays open instead. */}
        <Collapsible
          title="Notes"
          testId="job-notes"
          icon={<NotesIcon size={20} />}
          summary="Yours, and your coach's"
          lockedOpen={notesDirty}
          lockedReason="You've got a note here that hasn't been saved. Save it or clear the box, then close this."
        >
          <ClientJobNotes
            applicationId={app.id}
            jobfitRunId={app.jobfit_run_id}
            onDirtyChange={setNotesDirty}
          />
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

/**
 * Confidence, 1 to 5, matching the column's CHECK. Dots rather than stars: a
 * star reads as a rating of the interview, and this is how the round FELT,
 * which is a note to yourself.
 */
function ConfidenceDots({ level, onPick }: { level: number; onPick: (n: number) => void }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 8, height: 40 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onPick(n)}
          aria-label={`${n} out of 5`}
          aria-pressed={n <= level}
          style={{
            width: 20, height: 20, borderRadius: "50%", padding: 0, cursor: "pointer",
            background: n <= level ? S.meaning.replied.accent : "transparent",
            border: `1.5px solid ${n <= level ? S.meaning.replied.accent : S.text.muted}`,
          }}
        />
      ))}
    </span>
  )
}

/**
 * The draft an open interview is edited through. Date and time are kept SPLIT
 * because that is how the two inputs work; they are composed into an instant
 * only at save. Every field is a non-null string or number so the controls are
 * never switching between controlled and uncontrolled.
 */
type Draft = {
  interview_stage: string
  /** "" means unset, and stays unset. */
  interview_format: string
  date: string
  time: string
  interviewer_names: string
  status: string
  thank_you_sent: boolean
  confidence_level: number
  notes: string
}

function draftFrom(iv: Interview): Draft {
  return {
    interview_stage: iv.interview_stage,
    interview_format: iv.interview_format ?? "",
    // Through splitLocalInstant rather than the raw column, so a `date` value
    // and a timestamp both normalise to the "YYYY-MM-DD" the input needs.
    date: splitLocalInstant(iv.interview_date)?.date ?? "",
    time: splitLocalInstant(iv.interview_at)?.time ?? "",
    interviewer_names: iv.interviewer_names ?? "",
    status: iv.status,
    thank_you_sent: !!iv.thank_you_sent,
    confidence_level: iv.confidence_level ?? 3,
    notes: iv.notes ?? "",
  }
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
  const [format, setFormat] = useState("")
  const [date, setDate] = useState("")
  const [time, setTime] = useState("")
  const [who, setWho] = useState("")
  const [saving, setSaving] = useState(false)

  // The edit path. One row open at a time: two open editors on the same list
  // means two drafts of the same shape on screen with nothing distinguishing
  // which Save belongs to which.
  const [openId, setOpenId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [rowErr, setRowErr] = useState<string | null>(null)

  function toggle(iv: Interview) {
    setRowErr(null)
    if (openId === iv.id) { setOpenId(null); setDraft(null); return }
    setOpenId(iv.id)
    setDraft(draftFrom(iv))
  }

  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d))

  async function create() {
    if (saving) return
    setSaving(true)
    await authFetch("/api/interviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        application_id: applicationId,
        interview_stage: stage,
        interview_format: format || null,
        interview_date: date || null,
        // NULL unless BOTH were given. A date on its own must not become
        // midnight: that asserts a precision nobody supplied. See
        // composeLocalInstant in lib/localDate.ts.
        interview_at: composeLocalInstant(date, time),
        interviewer_names: who.trim() || null,
        status: date ? "scheduled" : "not_scheduled",
      }),
    })
    setSaving(false)
    setAdding(false)
    setDate(""); setTime(""); setWho(""); setStage("phone"); setFormat("")
    onChanged()
  }

  async function save(id: string) {
    if (!draft || saving) return
    setSaving(true)
    setRowErr(null)
    const res = await authFetch(`/api/interviews/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        interview_stage: draft.interview_stage,
        interview_format: draft.interview_format || null,
        interview_date: draft.date || null,
        interview_at: composeLocalInstant(draft.date, draft.time),
        interviewer_names: draft.interviewer_names.trim() || null,
        status: draft.status,
        thank_you_sent: draft.thank_you_sent,
        confidence_level: draft.confidence_level,
        notes: draft.notes.trim() || null,
      }),
    })
    setSaving(false)
    if (!res.ok) {
      // Said out loud rather than swallowed. A silently failed edit here reads
      // as a saved one, and the next screen would show the old value.
      setRowErr("That didn't save. Try again.")
      return
    }
    setOpenId(null); setDraft(null)
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
            const open = openId === iv.id
            return (
              <div key={iv.id} style={{ borderRadius: 12, background: S.well, overflow: "hidden" }}>
                {/* THE WHOLE ROW is the expand control, same as CompanyCard: a
                    real <button> so it is reachable by keyboard, and everything
                    inside it is phrasing content, because a div inside a button
                    is invalid HTML. */}
                <button
                  type="button"
                  onClick={() => toggle(iv)}
                  aria-expanded={open}
                  aria-label={`${open ? "Collapse" : "Edit"} ${interviewStageLabel(iv.interview_stage)}`}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", gap: 14,
                    padding: "12px 14px", background: "none", border: "none",
                    cursor: "pointer", textAlign: "left", font: "inherit",
                  }}
                >
                  <span aria-hidden="true" style={{ color: S.text.dim, fontSize: 12, width: 12, flexShrink: 0 }}>
                    {open ? "▾" : "▸"}
                  </span>
                  <InterviewIcon size={22} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 14.5, fontWeight: 700, color: S.text.primary }}>
                      {interviewStageLabel(iv.interview_stage)}
                    </span>
                    <span style={{ display: "block", fontSize: 13, color: S.text.muted, marginTop: 2 }}>
                      {[
                        longDate(iv.interview_date) || "No date yet",
                        timeLabel(iv),
                        iv.interview_format ? interviewFormatLabel(iv.interview_format) : null,
                        iv.interviewer_names,
                      ].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    <span style={ivst.dot} />
                    <span style={{ ...ivst.text, fontSize: 13.5, whiteSpace: "nowrap" }}>
                      {interviewStatusLabel(iv.status)}
                    </span>
                  </span>
                </button>

                {open && draft && (
                  <div style={{ padding: "4px 14px 16px", borderTop: `1px solid ${S.borderSoft}` }}>
                    <div style={{ ...formGrid, marginTop: 14 }}>
                      <Field label="What kind">
                        <Select
                          value={draft.interview_stage} options={STAGE_OPTIONS} ariaLabel="What kind"
                          onChange={(v) => set({ interview_stage: v })}
                        />
                      </Field>
                      <Field label="How you're meeting">
                        <Select
                          value={draft.interview_format} options={FORMAT_OPTIONS} ariaLabel="How you're meeting"
                          onChange={(v) => set({ interview_format: v })}
                        />
                      </Field>
                      <Field label="Date">
                        <input
                          type="date" value={draft.date} style={control} aria-label="Date"
                          onChange={(e) => set({ date: e.target.value })}
                        />
                      </Field>
                      <Field label="Time">
                        <input
                          type="time" value={draft.time} style={control} aria-label="Time"
                          onChange={(e) => set({ time: e.target.value })}
                        />
                      </Field>
                      <Field label="Who you're meeting">
                        <input
                          value={draft.interviewer_names} style={control} placeholder="Optional"
                          aria-label="Who you're meeting"
                          onChange={(e) => set({ interviewer_names: e.target.value })}
                        />
                      </Field>
                      <Field label="Where it stands">
                        <Select
                          value={draft.status} options={IV_STATUS_OPTIONS} ariaLabel="Where it stands"
                          onChange={(v) => set({ status: v })}
                        />
                      </Field>
                      <Field label="How it felt">
                        <ConfidenceDots
                          level={draft.confidence_level}
                          onPick={(n) => set({ confidence_level: n })}
                        />
                      </Field>
                      <Field label="Thank-you note">
                        <label
                          style={{
                            display: "flex", alignItems: "center", gap: 10, height: 40,
                            fontSize: 14, color: S.text.secondary, cursor: "pointer",
                          }}
                        >
                          <input
                            type="checkbox" checked={draft.thank_you_sent}
                            onChange={(e) => set({ thank_you_sent: e.target.checked })}
                            style={{ width: 18, height: 18, accentColor: S.meaning.done.accent, cursor: "pointer" }}
                          />
                          Sent
                        </label>
                      </Field>
                      <Field label="Notes" span={2}>
                        <textarea
                          value={draft.notes} style={areaControl} aria-label="Notes"
                          placeholder="What they asked, who you met, anything to remember"
                          onChange={(e) => set({ notes: e.target.value })}
                        />
                      </Field>
                    </div>

                    {draft.time && !draft.date && (
                      <p style={{ fontSize: 13, color: S.meaning.attention.ink, margin: "12px 0 0" }}>
                        A time needs a date to go with it. Add the day and the time will save too.
                      </p>
                    )}
                    {rowErr && (
                      <p style={{ fontSize: 13.5, color: S.meaning.error.ink, fontWeight: 700, margin: "12px 0 0" }}>
                        {rowErr}
                      </p>
                    )}

                    <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 16, flexWrap: "wrap" }}>
                      <button
                        onClick={() => void save(iv.id)}
                        disabled={saving}
                        style={{
                          ...actionStyle(S, "primary"), borderRadius: 10, padding: "10px 18px",
                          fontSize: 14, fontFamily: "inherit", opacity: saving ? 0.6 : 1,
                        }}
                      >
                        {saving ? "Saving…" : "Save changes"}
                      </button>
                      <button
                        onClick={() => { setOpenId(null); setDraft(null); setRowErr(null) }}
                        style={{
                          background: "none", border: "none", color: S.action.quietInk,
                          fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
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
            {/* Two separate questions. What ROUND it is drives nothing; how
                you ATTEND is what Prep Now branches on, and it is the one an
                invite always tells you. */}
            <Field label="How you're meeting">
              <Select value={format} options={FORMAT_OPTIONS} onChange={setFormat} ariaLabel="How you're meeting" />
            </Field>
            <Field label="Date">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={control} aria-label="Date" />
            </Field>
            <Field label="Time">
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={control} aria-label="Time" />
            </Field>
            <Field label="Who you're meeting">
              <input value={who} onChange={(e) => setWho(e.target.value)} style={control} placeholder="Optional" aria-label="Who you're meeting" />
            </Field>
          </div>
          {time && !date && (
            <p style={{ fontSize: 13, color: S.meaning.attention.ink, margin: "12px 0 0" }}>
              A time needs a date to go with it. Add the day and the time will save too.
            </p>
          )}
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
