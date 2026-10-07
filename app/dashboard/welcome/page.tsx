"use client"

// First-run welcome for coach-created clients. The create-client intro email's
// magic link redirects here (one-time link, first sign-in only); every later
// magic link routes to the Coaching Hub via /api/auth/send-link. No DB flag:
// the single-use link is the gate. Renders inside app/dashboard/layout.tsx,
// which performs the magic-link ?code= exchange, so the session is live here.
// Client-only in practice: a coach never lands here, so the page is built for
// the light ground the layout gives clients on this route.
//
// Three reads, all the client's own: /api/profile (their name), /api/me/welcome
// (coach and plan phases), /api/me/activities (released tasks). Any of them
// failing leaves that part out rather than blocking the screen.
//
// COLOUR. Brand orange and brand blue are marks, rails and fills, never words:
// both measure under 3:1 on white. Words in those families use the system's
// ink (LIGHT.meaning.progress.ink).

import { useCallback, useEffect, useState } from "react"
import { getSupabaseBrowser } from "../../../lib/supabase-browser"
import { FRAMER_URL } from "../../../lib/urls"
import { LIGHT as S, surfaceCard, action } from "../../../lib/theme/surfaces"

const NAVY = "#08203F"
const BLUE = S.meaning.progress.accent      // #009BFF, marks only
const BLUE_INK = S.meaning.progress.ink     // #00569A, labels
const ICE = "#B6F2F8"                       // callout fill
const TEAL = "#00B3B3"                      // done
const ORANGE = S.meaning.attention.accent   // #FF6B00, the eyebrow (on its navy chip, 5.7:1), rules, the first-step rail
const PEACH = S.meaning.attention.fill      // #FFEEDC, the first step
const SECONDARY = S.text.secondary

type Phase = { phase_id: string; label: string; status: "not_started" | "in_progress" | "complete" }
type Activity = { id: string; name: string; status: string; due_date: string | null }
type Group = { deliverable_id: string; name: string; activities: Activity[] }

async function getToken(): Promise<string | null> {
  const { data: { session } } = await getSupabaseBrowser().auth.getSession()
  if (session?.access_token) return session.access_token
  return sessionStorage.getItem("signal_handoff_token")
}

async function getJson(path: string, token: string): Promise<any | null> {
  try {
    const res = await fetch(path, { headers: { Authorization: `Bearer ${token}` } })
    const j = await res.json().catch(() => null)
    return res.ok && j ? j : null
  } catch {
    return null
  }
}

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("")

function fmtDue(d: string): string {
  const dt = new Date(`${d}T00:00:00`)
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

/** The phase marked "You are here": the first In progress, else the first not yet started. */
function currentPhase(phases: Phase[]): number {
  const inProgress = phases.findIndex((p) => p.status === "in_progress")
  return inProgress >= 0 ? inProgress : phases.findIndex((p) => p.status === "not_started")
}

const CSS = `
.wl { max-width: 820px; margin: 0 auto; padding: 4px 0 48px; color: ${NAVY}; }
.wl-rise { opacity: 0; transform: translateY(10px); animation: wl-rise 0.55s cubic-bezier(.2,.7,.2,1) forwards; }

.wl-hero { position: relative; overflow: hidden; border-radius: 22px; padding: 40px 44px 36px; background:
  radial-gradient(60% 80% at 100% 0%, rgba(182,242,248,0.55), transparent 70%),
  radial-gradient(40% 60% at 0% 100%, rgba(255,238,220,0.55), transparent 70%), #fff; }
.wl-hero::before { content: ""; position: absolute; inset: 0 0 auto 0; height: 4px; background: linear-gradient(90deg, ${ORANGE} 0 72px, transparent 72px); }
.wl h1 { font-size: 44px; line-height: 1.08; font-weight: 900; letter-spacing: -1.1px; margin: 14px 0 0; color: ${NAVY}; }
.wl-eyebrow { display: inline-flex; align-items: center; gap: 10px; font-size: 13px; font-weight: 800; letter-spacing: 0.14em; color: ${ORANGE};
  background: ${NAVY}; padding: 7px 14px 7px 12px; border-radius: 999px; }
.wl-eyebrow::before { content: ""; width: 9px; height: 9px; border-radius: 50%; background: ${ORANGE}; box-shadow: 0 0 0 3px rgba(255,107,0,0.35), 0 0 10px ${ORANGE}; }

.wl-coach { margin-top: 28px; display: flex; align-items: center; gap: 18px; background: ${ICE}; border-radius: 16px; padding: 18px 22px; }
.wl-avatar { width: 64px; height: 64px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #1B3A63, ${NAVY}); color: #fff; font-size: 22px; font-weight: 800; box-shadow: 0 0 0 4px #fff, 0 6px 16px rgba(8,32,63,0.18); }

.wl-card { border-radius: 20px; padding: 28px 30px; margin-top: 18px; }
.wl-label { display: flex; align-items: center; gap: 10px; font-size: 12.5px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; color: ${BLUE_INK}; margin: 0 0 22px; }
.wl-label::before { content: ""; width: 18px; height: 3px; border-radius: 2px; background: ${BLUE}; }

.wl-steps { list-style: none; margin: 0; padding: 0; display: flex; position: relative; }
.wl-step { position: relative; flex: 1; display: flex; flex-direction: column; align-items: center; text-align: center; min-width: 0; padding-top: 34px; }
.wl-step + .wl-step::before { content: ""; position: absolute; top: 53px; right: calc(50% + 24px); width: calc(100% - 48px); height: 3px; border-radius: 2px;
  background: ${S.border}; }
.wl-step + .wl-step::after { content: ""; position: absolute; top: 53px; right: calc(50% + 24px); width: calc(100% - 48px); height: 3px; border-radius: 2px;
  background: ${TEAL}; transform-origin: left; transform: scaleX(0); }
.wl-step.done + .wl-step::after { animation: wl-grow 0.5s ease-out forwards; animation-delay: inherit; }
.wl-dot { position: relative; z-index: 1; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
  font-size: 15px; font-weight: 800; background: #fff; border: 2px solid ${S.border}; color: ${SECONDARY};
  opacity: 0; transform: scale(0.6); animation: wl-pop 0.45s cubic-bezier(.3,1.4,.5,1) forwards; animation-delay: inherit; }
.wl-step.done .wl-dot { background: ${TEAL}; border-color: ${TEAL}; }
.wl-step.here .wl-dot { width: 44px; height: 44px; margin-top: -2px; background: ${NAVY}; border: 0; color: #fff;
  box-shadow: 0 0 0 5px #fff, 0 0 0 8px ${BLUE}; }
.wl-step.here .wl-dot::after { content: ""; position: absolute; inset: -8px; border-radius: 50%; border: 3px solid ${BLUE}; animation: wl-pulse 1.8s ease-out 1s 3; opacity: 0; }
.wl-name { margin-top: 12px; font-size: 15px; font-weight: 700; line-height: 1.3; padding: 0 4px; overflow-wrap: anywhere; color: ${NAVY}; }
.wl-sub { display: block; font-size: 13px; font-weight: 600; margin-top: 2px; color: ${SECONDARY}; }
.wl-here { position: absolute; top: 0; left: 50%; transform: translateX(-50%); white-space: nowrap; background: ${NAVY}; color: #fff;
  font-size: 12px; font-weight: 800; padding: 4px 11px; border-radius: 999px; }

.wl-first { background: ${PEACH}; border-radius: 20px; padding: 26px 28px; margin-top: 18px; position: relative; overflow: hidden; box-shadow: ${S.shadow.card}; }
.wl-first::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 6px; background: ${ORANGE}; }

.wl-tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 18px; }
.wl-tile { display: flex; flex-direction: column; text-decoration: none; color: ${NAVY}; border-radius: 18px; padding: 22px;
  transition: box-shadow 0.18s, transform 0.18s; }
.wl-tile:hover { box-shadow: ${S.shadow.raised}; transform: translateY(-2px); }
.wl-tile:hover .wl-go { transform: translateX(3px); }
.wl-go { margin-top: auto; padding-top: 14px; font-size: 14px; font-weight: 800; color: ${BLUE_INK}; transition: transform 0.18s; }
.wl-tile:focus-visible, .wl-btn:focus-visible, .wl-link:focus-visible { outline: 3px solid ${BLUE}; outline-offset: 3px; }

.wl-btn { display: inline-block; text-decoration: none; font-size: 16px; padding: 15px 28px; border-radius: 12px; font-family: inherit; }
.wl-btn:disabled { opacity: 0.6; cursor: default; }
.wl-link { color: ${NAVY}; font-weight: 700; font-size: 15.5px; text-decoration: underline; text-decoration-color: ${BLUE}; text-decoration-thickness: 2px; text-underline-offset: 5px; }

@keyframes wl-rise { to { opacity: 1; transform: none; } }
@keyframes wl-grow { to { transform: scaleX(1); } }
@keyframes wl-grow-y { to { transform: scaleY(1); } }
@keyframes wl-pop { to { opacity: 1; transform: none; } }
@keyframes wl-pulse { 0% { opacity: 0.7; transform: scale(1); } 100% { opacity: 0; transform: scale(1.35); } }

@media (max-width: 640px) {
  .wl-hero { padding: 30px 22px 26px; border-radius: 18px; }
  .wl h1 { font-size: 32px; letter-spacing: -0.6px; }
  .wl-coach { padding: 16px; gap: 14px; }
  .wl-avatar { width: 52px; height: 52px; font-size: 18px; }
  .wl-card, .wl-first { padding: 22px 20px; }
  .wl-steps { flex-direction: column; }
  .wl-step { flex-direction: row; align-items: center; text-align: left; gap: 14px; padding: 0 0 24px; }
  .wl-step:last-child { padding-bottom: 0; }
  .wl-step + .wl-step::before, .wl-step + .wl-step::after { top: -24px; left: 18.5px; right: auto; width: 3px; height: 20px; }
  .wl-step + .wl-step::after { transform-origin: top; transform: scaleY(0); }
  .wl-step.done + .wl-step::after { animation-name: wl-grow-y; }
  .wl-step.here .wl-dot { margin: 0 -2px; }
  .wl-name { margin-top: 0; }
  .wl-here { position: static; transform: none; margin-left: auto; }
  .wl-tiles { grid-template-columns: 1fr; gap: 12px; }
  .wl-btn { display: block; text-align: center; width: 100%; }
}
@media (prefers-reduced-motion: reduce) {
  .wl-rise, .wl-dot, .wl-step + .wl-step::after, .wl-step.here .wl-dot::after { animation: none !important; opacity: 1; transform: none; }
  .wl-step.here .wl-dot::after { opacity: 0; }
}
`

function Check({ color = NAVY, size = 18 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-7" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function PlanStepper({ phases }: { phases: Phase[] }) {
  const here = currentPhase(phases)
  return (
    <ol className="wl-steps">
      {phases.map((p, i) => {
        const done = p.status === "complete"
        const cls = `wl-step${done ? " done" : ""}${i === here ? " here" : ""}`
        return (
          <li key={p.phase_id} className={cls} style={{ animationDelay: `${0.35 + i * 0.14}s` }}
            aria-current={i === here ? "step" : undefined}>
            <span className="wl-dot">{done ? <Check /> : i + 1}</span>
            <span className="wl-name">
              {p.label}
              {done && <span className="wl-sub">Done</span>}
            </span>
            {i === here && <span className="wl-here">You are here</span>}
          </li>
        )
      })}
    </ol>
  )
}

function FirstStep({ groups, onDone }: { groups: Group[] | null; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [finished, setFinished] = useState<string | null>(null)

  const all = (groups ?? []).flatMap((g) => g.activities.map((a) => ({ ...a, deliverable: g.name })))
  const task = all.find((a) => a.status !== "complete") ?? null

  async function markComplete(id: string, name: string) {
    setBusy(true)
    setError(null)
    try {
      const token = await getToken()
      if (!token) { setError("Please sign in again."); return }
      const res = await fetch(`/api/me/activities/${id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ status: "complete" }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) { setError(j?.error || `Couldn't mark that complete (${res.status})`); return }
      setFinished(name)
      onDone()
    } catch {
      setError("Network error. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="wl-first wl-rise" style={{ animationDelay: "0.3s" }} aria-label="Your first step">
      <h2 className="wl-label" style={{ marginBottom: 14 }}>Your first step</h2>
      {groups === null ? (
        <div style={{ height: 52 }} aria-busy="true" />
      ) : (
        <>
          {finished && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 16, fontWeight: 700, marginBottom: task ? 18 : 0 }}>
              <span style={{ width: 28, height: 28, borderRadius: "50%", background: TEAL, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Check size={16} />
              </span>
              {finished} is done. Your coach can see it.
            </div>
          )}
          {task ? (
            <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 18 }}>
              <div style={{ flex: "1 1 280px", minWidth: 0 }}>
                <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.25, overflowWrap: "anywhere" }}>{task.name}</div>
                <div style={{ fontSize: 15, marginTop: 6, color: SECONDARY }}>
                  {task.deliverable}
                  {task.due_date && <strong style={{ color: NAVY }}> · Due {fmtDue(task.due_date)}</strong>}
                </div>
              </div>
              <button type="button" className="wl-btn" disabled={busy} onClick={() => void markComplete(task.id, task.name)}
                style={action(S, "primary")}>
                {busy ? "Saving..." : "Mark complete"}
              </button>
            </div>
          ) : !finished && (
            <div style={{ fontSize: 18, fontWeight: 700 }}>Your coach is setting up your first step.</div>
          )}
          {error && <div role="alert" style={{ marginTop: 12, fontSize: 15, fontWeight: 700, color: S.meaning.error.ink }}>{error}</div>}
        </>
      )}
    </section>
  )
}

const TILES = [
  { href: "/dashboard/coaching-hub", title: "Coaching Hub", text: "Where you and your coach work together: your plan, your next steps and shared documents", icon: "M4 11.5l8-7 8 7M6.5 10v9.5h11V10" },
  { href: "/dashboard/tracker", title: "Job Tracker", text: "Your applications and the jobs your coach sends you", icon: "M5 7h14M5 12h14M5 17h9" },
  { href: `${FRAMER_URL}/signal/jobfit`, title: "Job Fit", text: "Check any posting against your profile", icon: "M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.5 15.5L20 20" },
]

export default function WelcomePage() {
  const [firstName, setFirstName] = useState<string | null>(null)
  const [coach, setCoach] = useState<{ name: string | null } | null>(null)
  const [phases, setPhases] = useState<Phase[]>([])
  const [groups, setGroups] = useState<Group[] | null>(null)

  const loadTasks = useCallback(async () => {
    const token = await getToken()
    const j = token ? await getJson("/api/me/activities", token) : null
    setGroups(j?.groups ?? [])
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const token = await getToken()
      if (!token) { setGroups([]); return }
      const [profile, welcome] = await Promise.all([getJson("/api/profile", token), getJson("/api/me/welcome", token), loadTasks()])
      if (cancelled) return
      const full = (profile?.profile?.name || "").trim()
      if (full) setFirstName(full.split(/\s+/)[0])
      setCoach(welcome?.coach ?? null)
      setPhases(welcome?.phases ?? [])
    })()
    return () => { cancelled = true }
  }, [loadTasks])

  return (
    <div className="wl">
      <style>{CSS}</style>

      <header className="wl-hero wl-rise" style={{ ...surfaceCard(S, true), border: "none" }}>
        <div className="wl-eyebrow">WELCOME TO SIGNAL</div>
        <h1>Your search starts here{firstName ? `, ${firstName}` : ""}.</h1>

        {coach && (
          <div className="wl-coach">
            <div className="wl-avatar" aria-hidden="true">
              {coach.name ? initials(coach.name) : (
                <svg width="28" height="28" viewBox="0 0 24 24"><circle cx="12" cy="9" r="4" fill="#fff" /><path d="M4 21c1-4.5 4.5-6.5 8-6.5s7 2 8 6.5" fill="#fff" /></svg>
              )}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 18, fontWeight: 800 }}>{coach.name ? `${coach.name}, your coach` : "Your coach"}</div>
              <div style={{ fontSize: 16, lineHeight: 1.5, marginTop: 3 }}>
                I&apos;ll be with you at every stage. Everything we do together lives here.
              </div>
            </div>
          </div>
        )}
      </header>

      {phases.length > 0 && (
        <section className="wl-card wl-rise" style={{ ...surfaceCard(S), animationDelay: "0.15s" }} aria-label="Your plan">
          <h2 className="wl-label">Your plan</h2>
          <PlanStepper phases={phases} />
        </section>
      )}

      <FirstStep groups={groups} onDone={() => void loadTasks()} />

      <nav className="wl-tiles" aria-label="Where things live">
        {TILES.map((t, i) => (
          <a key={t.title} href={t.href} className="wl-tile wl-rise" style={{ ...surfaceCard(S), animationDelay: `${0.45 + i * 0.08}s` }}>
            <span aria-hidden="true" style={{ width: 44, height: 44, borderRadius: 12, background: ICE, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
              <svg width="22" height="22" viewBox="0 0 24 24"><path d={t.icon} fill="none" stroke={NAVY} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
            <span style={{ display: "block", fontSize: 17, fontWeight: 800 }}>{t.title}</span>
            <span style={{ display: "block", fontSize: 15, lineHeight: 1.45, marginTop: 4, color: SECONDARY }}>{t.text}</span>
            <span className="wl-go" aria-hidden="true">Open →</span>
          </a>
        ))}
      </nav>

      <div className="wl-card wl-rise" style={{ ...surfaceCard(S), display: "flex", alignItems: "center", flexWrap: "wrap", gap: "16px 28px", animationDelay: "0.6s" }}>
        <a href="/dashboard/coaching-hub" className="wl-btn" style={action(S, "primary")}>Go to my Coaching Hub</a>
        <a href="/dashboard/profile" className="wl-link">Review my profile</a>
      </div>
    </div>
  )
}
