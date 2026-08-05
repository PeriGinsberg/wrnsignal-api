"use client"

// The Dashboard: HOME, and the single "what needs you" surface for the whole
// app. It ADAPTS to where the student is rather than showing everything at
// once, because a wall of panels is the thing a student with no coach cannot
// parse. One or two things, never a wall.
//
// The five states and their priority live in dashboardState.ts as a pure
// function, so which screen you get is testable without a browser. This file is
// the rendering of that decision and nothing else.
//
// Redesign step 6 (2026-08-04). This route used to be "My Account": profile
// summary, resume personas, coach recommendations and a refund panel on one
// page. None of that belongs on a what-needs-you home, and it was moved WHOLE
// to /dashboard/profile rather than dropped, because personas and the refund
// window have no other home until My Profile grows its Resume and Account
// sections. See profile/LegacyAccountPanel.tsx.

import { useCallback, useEffect, useState } from "react"
import { getSupabaseBrowser } from "../../lib/supabase-browser"
import { LIGHT as S, DARK, action as actionStyle, orb } from "../../lib/theme/surfaces"
import { formatLong } from "../../lib/localDate"
import { FRAMER_URL } from "../../lib/urls"
import { timeAgo } from "../../lib/relativeTime"
import {
  ScoreAJobIcon, TrackIcon, NetworkIcon, InterviewIcon, MomentumIcon,
  PinIcon, RepliedIcon, QuietIcon,
} from "../../components/icons"
import { buildDashboard, type DashboardModel, type DashboardState } from "./dashboardState"

// DEV-ONLY state preview. A five-state screen cannot be reviewed by anyone,
// including its author, when an account only ever occupies one state at a time,
// and the alternative is editing real profile rows to move between them. So
// ?preview=<state> renders that state against a small fixture.
//
// Gated on NEXT_PUBLIC_DEV_AUTH, the same flag as the dev password sign-in, so
// it is absent from the production bundle's behaviour entirely. Without the
// flag the parameter is ignored and the real model always wins.
const PREVIEW_ENABLED = process.env.NEXT_PUBLIC_DEV_AUTH === "true"

function previewModel(state: DashboardState, real: DashboardModel): DashboardModel {
  const day = 86400000
  const iso = (d: number) => new Date(Date.now() - d * day).toISOString()
  const fixture: Partial<DashboardModel> = {
    state,
    completion: state === "new" ? { percent: 40, missing: 3 } : { percent: 100, missing: 0 },
    due: state === "active" || state === "interview"
      ? [{ id: "p1" }, { id: "p2" }, { id: "p3" }] as DashboardModel["due"]
      : [],
    awaiting: state === "active" || state === "quiet"
      ? [{ id: "p4", first_name: "Grace", last_name: "Lin", stage: "replied", last_action_at: iso(2) }] as DashboardModel["awaiting"]
      : [],
    stale: state === "active" || state === "quiet"
      ? [{ id: "p5", company_name: "Globex", application_status: "applied", applied_date: iso(20) }] as DashboardModel["stale"]
      : [],
    saved: [],
    interview: state === "interview"
      ? { id: "p6", interview_date: new Date(Date.now() + 3 * day).toISOString(), status: "scheduled", company_name: "Globex", job_title: "Senior PM", interview_stage: "final_round" }
      : null,
    daysToInterview: state === "interview" ? 3 : 0,
    appliedThisWeek: state === "active" ? 4 : 0,
    reachedThisWeek: state === "active" ? 6 : 0,
    quietDays: state === "quiet" ? 9 : 0,
  }
  return { ...real, ...fixture } as DashboardModel
}

const JOBFIT_URL = `${FRAMER_URL}/signal/jobfit`

async function getToken(): Promise<string | null> {
  const { data: { session } } = await getSupabaseBrowser().auth.getSession()
  if (session?.access_token) return session.access_token
  return sessionStorage.getItem("signal_handoff_token")
}

export default function DashboardPage() {
  const [model, setModel] = useState<DashboardModel | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const token = await getToken()
      if (!token) { setError("Please sign in again."); return }
      const headers = { Authorization: `Bearer ${token}` }
      // Four independent reads. Any one failing degrades that section rather
      // than the page: a student whose networking call times out should still
      // see their applications, not an error screen.
      const [p, a, c, i] = await Promise.all([
        fetch("/api/profile", { headers }).then((r) => r.json()).catch(() => ({})),
        fetch("/api/applications", { headers }).then((r) => r.json()).catch(() => ({})),
        fetch("/api/network/contacts", { headers }).then((r) => r.json()).catch(() => ({})),
        fetch("/api/interviews", { headers }).then((r) => r.json()).catch(() => ({})),
      ])
      setModel(buildDashboard({
        profile: p?.profile ?? null,
        applications: a?.applications ?? [],
        contacts: c?.contacts ?? [],
        interviews: i?.interviews ?? [],
      }))
    } catch (e: any) {
      setError(e?.message || String(e))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  if (error) return <main style={wrap}><p style={{ color: S.meaning.error.ink }}>{error}</p></main>
  if (!model) return <main style={wrap}><p style={{ color: S.text.muted }}>Loading…</p></main>

  const requested = PREVIEW_ENABLED && typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("preview")
    : null
  const previewing = requested && ["new", "ready", "active", "interview", "quiet"].includes(requested)
  const shown = previewing ? previewModel(requested as DashboardState, model) : model

  const model2 = shown
  const sub: Record<string, string> = {
    new: "Let's get you set up. Here's your first step.",
    ready: "You're all set up. Time to make your first move.",
    active: "Here's what needs you today.",
    interview: "You have an interview coming up. Let's get you ready.",
    quiet: "Welcome back. Let's pick up where you left off.",
  }

  return (
    <main style={wrap}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20 }}>
        <div>
          <h1 style={{ fontSize: 34, fontWeight: 800, letterSpacing: -0.6, color: S.text.primary, margin: 0 }}>
            Hello{model2.firstName ? `, ${model2.firstName}` : ""} 👋
          </h1>
          <p style={{ color: S.text.muted, fontSize: 15.5, margin: "6px 0 0" }}>{sub[model2.state]}</p>
        </div>
        {/* Quiet, on every state. The profile is always reachable without the
            screen having to nag about it. */}
        <a href="/dashboard/profile" style={editProfile}>Edit profile</a>
      </div>

      {previewing && (
        <div style={{ marginTop: 16, padding: "10px 16px", borderRadius: 10, background: S.meaning.attention.fill, color: S.meaning.attention.ink, fontSize: 13.5, fontWeight: 700 }}>
          Previewing the “{requested}” state with fixture data. Dev only.
        </div>
      )}
      {model2.state === "new" && <NewStudent model={model2} />}
      {model2.state === "ready" && <Ready />}
      {model2.state === "interview" && <Interview model={model2} />}
      {model2.state === "quiet" && <Quiet model={model2} />}
      {model2.state === "active" && <Active model={model2} />}
    </main>
  )
}

// ── New student: one thing, and nothing competing with it ───────────────────
function NewStudent({ model }: { model: DashboardModel }) {
  const { percent, missing } = model.completion
  return (
    <>
      <section style={{ ...hero, marginTop: 22 }}>
        <div style={{ ...heroEyebrow, color: S.hero.accent }}>✦ Start here</div>
        <h2 style={heroTitle}>Finish your profile</h2>
        <p style={heroBody}>
          Everything SIGNAL does, scoring jobs and writing your outreach, starts with knowing who you
          are and what you're after. About 3 minutes.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 14, margin: "22px 0 20px" }}>
          <div style={{ flex: 1, height: 10, borderRadius: 999, background: "rgba(255,255,255,0.14)" }}>
            <div style={{ width: `${percent}%`, height: "100%", borderRadius: 999, background: S.hero.accent }} />
          </div>
          <span style={{ color: S.hero.ink, fontSize: 15, fontWeight: 800 }}>{percent}%</span>
        </div>
        <a href="/dashboard/profile" style={{ ...actionStyle(S, "primary"), ...bigBtn, textDecoration: "none" }}>
          Finish my profile →
        </a>
        {missing > 0 && (
          <span style={{ color: S.hero.muted, fontSize: 13.5, marginLeft: 14 }}>
            {missing} {missing === 1 ? "field" : "fields"} left
          </span>
        )}
      </section>

      <div style={{ ...sectionLabel, marginTop: 28 }}>Then you'll be ready to</div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <OrbCard tone="teal" href={JOBFIT_URL} title="Score a job" sub="See if it's a fit" icon={<ScoreAJobIcon size={28} />} external />
        <OrbCard tone="blue" href="/dashboard/tracker" title="Track applications" sub="Jobs you're serious about" icon={<TrackIcon size={28} />} />
        <OrbCard tone="peach" href="/dashboard/network/contacts" title="Network your way in" sub="Reach real people" icon={<NetworkIcon size={28} />} />
      </div>
      <p style={{ textAlign: "center", color: S.text.muted, fontSize: 14, marginTop: 22 }}>
        One step at a time. We'll guide you the whole way.
      </p>
    </>
  )
}

// ── Ready: set up, nothing tracked. Two ways in, no third option ────────────
function Ready() {
  return (
    <>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 24 }}>
        <OrbCard
          tone="teal" href={JOBFIT_URL} external
          title="Score your first job" sub="See how strong a match you are, and how to stand out" icon={<ScoreAJobIcon size={28} />}
        />
        <OrbCard
          tone="peach" href="/dashboard/network/contacts"
          title="Start networking" sub="Reach the people who can get you in" icon={<NetworkIcon size={28} />}
        />
      </div>
      <p style={{ textAlign: "center", color: S.text.muted, fontSize: 14, marginTop: 22 }}>
        Your profile's done, so everything's ready to personalise for you.
      </p>
    </>
  )
}

// ── Interview: time-bound, so it takes the whole top ────────────────────────
function Interview({ model }: { model: DashboardModel }) {
  const iv = model.interview!
  const days = model.daysToInterview
  const when = days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`
  const where = [iv.job_title, iv.company_name].filter(Boolean).join(" at ") || "your interview"

  return (
    <>
      {/* CORAL frame, navy fill, peach button inside it. This card is the
          clearest argument for moving attention off amber: the frame and the
          button used to be the same hue, so "this is urgent" and "press this"
          were one colour doing two jobs. Now the frame says urgent and the
          button says press, and they no longer have to be told apart by shape.
          The frame is a border rather than a surface, so it still reads as
          emphasis rather than as something to press.
          The eyebrow takes the DARK attention ink, not the light accent: this
          is a navy card, and #F26B52 measures 3.82 against its lightest stop. */}
      <section style={{ ...hero, marginTop: 22, border: `2px solid ${S.meaning.attention.accent}` }}>
        <div style={{ ...heroEyebrow, color: DARK.meaning.attention.ink, display: "flex", alignItems: "center", gap: 9 }}>
          <InterviewIcon size={22} /> Interview {when}
        </div>
        <h2 style={heroTitle}>{where}</h2>
        {/* formatLong, not `new Date(...).toLocaleDateString()`. interview_date
            is a `date` column, so it arrives as a bare "2026-08-07"; the spec
            parses that as UTC midnight, which renders a day early for every
            user west of UTC. This hero was missed when the rest of the tracker
            moved to lib/localDate, so it has been showing the wrong day. */}
        <p style={heroBody}>
          {formatLong(iv.interview_date)}
          {iv.interview_stage ? ` · ${iv.interview_stage.replace(/_/g, " ")}` : ""}
        </p>
        <div style={{ ...sectionLabel, color: S.hero.muted, marginTop: 22 }}>Now is the time to prep</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {/* Straight to Prep Now for THIS interview. It used to land on the
              tracker index, which did not even name the job. */}
          <a href={`/dashboard/tracker/interviews/${iv.id}`} style={{ ...actionStyle(S, "primary"), ...bigBtn, textDecoration: "none" }}>
            Prep now →
          </a>
          <a href="/dashboard/network/contacts" style={{ ...heroSecondary, textDecoration: "none" }}>
            Reach your contacts there
          </a>
        </div>
        {/* Soft promotion: contextual, below the free value, teaches rather
            than sells. The template for all future soft promotion. */}
        <p style={{ color: S.hero.muted, fontSize: 13.5, margin: "20px 0 0", lineHeight: "20px" }}>
          Want to walk in more prepared? The Ultimate Interview Playbook takes you through all of
          this, step by step.
        </p>
      </section>

      <div style={{ ...sectionLabel, marginTop: 28 }}>Also today</div>
      <CountRow model={model} />
    </>
  )
}

// ── Quiet: warm, no guilt, and a concrete reason to come back ───────────────
function Quiet({ model }: { model: DashboardModel }) {
  return (
    <>
      <section style={{ ...hero, marginTop: 22 }}>
        <div style={{ ...heroEyebrow, color: S.hero.accent, display: "flex", alignItems: "center", gap: 9 }}>
          <QuietIcon size={20} /> Still in your corner
        </div>
        <h2 style={heroTitle}>It's been {model.quietDays} days. No worries, let's get moving again.</h2>
        <p style={heroBody}>
          Job searches never run steady. The trick is small, steady steps. Pick one thing below and
          you're back in it.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 20 }}>
          <a href={JOBFIT_URL} style={{ ...actionStyle(S, "primary"), ...bigBtn, textDecoration: "none" }}>
            Score a new job
          </a>
          <a href="/dashboard/network/contacts" style={{ ...heroSecondary, textDecoration: "none" }}>
            Reach out to someone
          </a>
        </div>
      </section>

      {(model.awaiting.length > 0 || model.stale.length > 0) && (
        <>
          <div style={{ ...sectionLabel, marginTop: 28 }}>While you were away</div>
          <Nudges model={model} />
        </>
      )}
    </>
  )
}

// ── Active: the normal working state ────────────────────────────────────────
function Active({ model }: { model: DashboardModel }) {
  const momentum = model.appliedThisWeek > 0 || model.reachedThisWeek > 0
  return (
    <>
      <div style={{ marginTop: 24 }}><CountRow model={model} /></div>

      {momentum && (
        <div style={momentumBar}>
          <span
            style={{
              display: "inline-flex", padding: 6, borderRadius: 9, marginRight: 12,
              background: "rgba(255,255,255,0.22)", verticalAlign: "-9px",
            }}
          >
            <MomentumIcon size={20} />
          </span>
          This week:{" "}
          <strong style={{ fontWeight: 800 }}>{model.appliedThisWeek} jobs applied</strong>,{" "}
          <strong style={{ fontWeight: 800 }}>{model.reachedThisWeek} people reached</strong>. Keep going.
        </div>
      )}

      {(model.awaiting.length > 0 || model.stale.length > 0 || model.saved.length > 0) && (
        <>
          <div style={{ ...sectionLabel, marginTop: 26 }}>A couple things to keep moving</div>
          <Nudges model={model} />
        </>
      )}
    </>
  )
}

// The two cross-app counts. Peach is people (the thing students avoid), blue is
// applications. Both are orbs because both are a way IN to a section.
function CountRow({ model }: { model: DashboardModel }) {
  const people = model.due.length
  const jobs = model.stale.length + model.saved.length
  if (people === 0 && jobs === 0) {
    return (
      <div style={{ ...card, padding: "22px 24px", color: S.text.muted, fontSize: 15 }}>
        Nothing needs you right now. Good place to be.
      </div>
    )
  }
  return (
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
      {people > 0 && (
        <CountOrb
          tone="peach" href="/dashboard/network/contacts" n={people}
          title={`${people === 1 ? "person" : "people"} to reach out to`} sub="Networking →"
        />
      )}
      {jobs > 0 && (
        <CountOrb
          tone="blue" href="/dashboard/tracker" n={jobs}
          title={`${jobs === 1 ? "job" : "jobs"} to follow up on`} sub="Job Tracker →"
        />
      )}
    </div>
  )
}

// Specific, never vague. Each nudge names the person or the company.
function Nudges({ model }: { model: DashboardModel }) {
  const items: { key: string; icon: React.ReactNode; body: React.ReactNode; href: string; cta: string; tone: "attention" | "replied" }[] = []

  for (const c of model.awaiting.slice(0, 2)) {
    items.push({
      key: `r-${c.id}`, icon: <RepliedIcon size={26} />, tone: "replied",
      body: <><strong>{c.first_name} {c.last_name}</strong> replied {timeAgo(c.last_action_at) ?? "recently"}. Don't leave them hanging.</>,
      href: `/dashboard/network/contacts/${c.id}`, cta: "Reply →",
    })
  }
  for (const a of model.stale.slice(0, 2)) {
    items.push({
      key: `s-${a.id}`, icon: <PinIcon size={26} />, tone: "attention",
      body: <>You applied to <strong>{a.company_name || "a company"}</strong> over two weeks ago with no word back. Worth a follow-up.</>,
      href: "/dashboard/tracker", cta: "Show me →",
    })
  }
  if (items.length === 0) {
    for (const a of model.saved.slice(0, 2)) {
      items.push({
        key: `v-${a.id}`, icon: <PinIcon size={26} />, tone: "attention",
        body: <>You saved <strong>{a.job_title || "a job"}</strong>{a.company_name ? ` at ${a.company_name}` : ""} but haven't applied yet.</>,
        href: "/dashboard/tracker", cta: "Show me →",
      })
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {items.slice(0, 3).map((it) => (
        <div key={it.key} style={{ ...card, ...nudgeCard, borderLeft: `3px solid ${S.meaning[it.tone].accent}` }}>
          <span style={{ flexShrink: 0, display: "flex" }}>{it.icon}</span>
          <span style={{ flex: 1, color: S.text.secondary, fontSize: 15, lineHeight: "22px" }}>{it.body}</span>
          <a href={it.href} style={{ color: S.action.quietInk, fontSize: 14.5, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap" }}>
            {it.cta}
          </a>
        </div>
      ))}
    </div>
  )
}

function OrbCard({
  tone, href, title, sub, icon, external = false,
}: {
  tone: "teal" | "blue" | "peach"; href: string; title: string; sub: string
  icon?: React.ReactNode; external?: boolean
}) {
  const o = orb(S, tone)
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      style={{ ...o, ...orbCard, textDecoration: "none" }}
    >
      {icon && (
        // Frosted tile behind the mark, per the orb spec. Keeps a two-tone icon
        // legible on a saturated gradient without recolouring the artwork.
        <span
          style={{
            display: "inline-flex", padding: 9, borderRadius: 12, marginBottom: 14,
            background: "rgba(255,255,255,0.22)",
          }}
        >
          {icon}
        </span>
      )}
      <span style={{ display: "block", fontSize: 19, fontWeight: 800 }}>{title}</span>
      <span style={{ display: "block", fontSize: 14, marginTop: 4, opacity: 0.85 }}>{sub}</span>
    </a>
  )
}

function CountOrb({
  tone, href, n, title, sub,
}: {
  tone: "teal" | "blue" | "peach"; href: string; n: number; title: string; sub: string
}) {
  const o = orb(S, tone)
  return (
    <a href={href} style={{ ...o, ...orbCard, textDecoration: "none", display: "flex", alignItems: "center", gap: 18 }}>
      <span style={{ fontSize: 46, fontWeight: 900, lineHeight: 1 }}>{n}</span>
      <span>
        <span style={{ display: "block", fontSize: 19, fontWeight: 800 }}>{title}</span>
        <span style={{ display: "block", fontSize: 14, marginTop: 3, opacity: 0.85, fontWeight: 700 }}>{sub}</span>
      </span>
    </a>
  )
}

const wrap: React.CSSProperties = { maxWidth: 1080 }
const card: React.CSSProperties = {
  background: S.card, border: `1px solid ${S.borderSoft}`, borderRadius: 14, boxShadow: S.shadow.card,
}
const hero: React.CSSProperties = {
  background: S.hero.background, borderRadius: 18, padding: "26px 28px", boxShadow: S.shadow.raised,
}
const heroEyebrow: React.CSSProperties = {
  fontSize: 12, fontWeight: 800, letterSpacing: 1.4, textTransform: "uppercase", marginBottom: 10,
}
const heroTitle: React.CSSProperties = {
  color: "#FFFFFF", fontSize: 27, fontWeight: 800, letterSpacing: -0.4, margin: 0, textWrap: "balance",
}
const heroBody: React.CSSProperties = {
  color: S.hero.muted, fontSize: 15.5, lineHeight: "24px", margin: "10px 0 0", maxWidth: "68ch",
}
const heroSecondary: React.CSSProperties = {
  background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.16)",
  color: S.hero.ink, borderRadius: 10, padding: "13px 22px", fontSize: 15, fontWeight: 800,
  fontFamily: "inherit", cursor: "pointer",
}
const bigBtn: React.CSSProperties = {
  borderRadius: 10, padding: "13px 22px", fontSize: 15, fontFamily: "inherit", display: "inline-block",
}
const sectionLabel: React.CSSProperties = {
  fontSize: 12, fontWeight: 800, letterSpacing: 1.4, textTransform: "uppercase",
  color: S.text.muted, marginBottom: 12,
}
const orbCard: React.CSSProperties = {
  flex: "1 1 260px", borderRadius: 16, padding: "22px 24px", minWidth: 240,
}
const momentumBar: React.CSSProperties = {
  marginTop: 14, padding: "16px 22px", borderRadius: 14,
  background: `linear-gradient(135deg, ${S.meaning.spoke.accent}, ${S.meaning.replied.accent})`,
  color: "#FFFFFF", fontSize: 15.5,
}
const nudgeCard: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 14, padding: "16px 20px",
}
const editProfile: React.CSSProperties = {
  background: S.card, border: `1px solid ${S.border}`, color: S.text.primary,
  borderRadius: 999, padding: "9px 18px", fontSize: 14, fontWeight: 700,
  textDecoration: "none", whiteSpace: "nowrap", boxShadow: S.shadow.card, flexShrink: 0,
}
