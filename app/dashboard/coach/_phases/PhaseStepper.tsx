"use client"

// The Phase stepper on a client record: each of the coach's phases with this
// client's status, and tasks done out of total. Built from the prospect stage
// stepper's layout (circles joined by connectors, label underneath), but its
// own component: the prospect pipeline is untouched.
//
// Clicking a phase that is in the plan lets the coach set Not started, In
// progress or Complete. Moving a phase back asks first. "Not in plan" phases
// are dimmed and cannot be set: they come from the client's approved packages.
// The rules live in lib/phases/service.ts.

import { Fragment, useCallback, useEffect, useState } from "react"
import { card, eyebrow } from "../../../../lib/dashboard-theme"
import { TYPE } from "../../../../lib/theme/surfaces"
import { getSupabaseBrowser } from "../../../../lib/supabase-browser"
import {
  PHASE_COLORS,
  PHASE_STATUS_LABEL,
  SETTABLE_PHASE_STATUSES,
  isMoveBack,
  type ClientPhase,
  type SettablePhaseStatus,
} from "@/lib/phases/model"

const NAVY = PHASE_COLORS.text

async function authFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  const { data: { session } } = await getSupabaseBrowser().auth.getSession()
  const token = session?.access_token || sessionStorage.getItem("signal_handoff_token")
  return fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}`, ...(opts.body ? { "Content-Type": "application/json" } : {}) },
  })
}

/** The circle for each status, in the agreed colours. */
function circleStyle(status: ClientPhase["status"]): React.CSSProperties {
  switch (status) {
    case "complete": return { background: PHASE_COLORS.complete, border: `2px solid ${PHASE_COLORS.complete}`, color: "#fff" }
    case "in_progress": return { background: PHASE_COLORS.in_progress, border: `2px solid ${PHASE_COLORS.in_progress}`, color: "#fff" }
    case "not_started": return { background: "#fff", border: `2px solid ${PHASE_COLORS.not_started}`, color: NAVY }
    default: return { background: "#F1F3F5", border: `2px dashed ${PHASE_COLORS.not_in_plan}`, color: PHASE_COLORS.not_in_plan }
  }
}

export function PhaseStepper({ coachClientId }: { coachClientId: string | null }) {
  const [phases, setPhases] = useState<ClientPhase[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picking, setPicking] = useState<ClientPhase | null>(null)
  const [confirming, setConfirming] = useState<{ phase: ClientPhase; to: SettablePhaseStatus } | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!coachClientId) return
    try {
      const res = await authFetch(`/api/coach/coach-clients/${coachClientId}/phases`)
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) { setError(j?.error || "Couldn't load phases"); return }
      setPhases(j.phases as ClientPhase[])
      setError(null)
    } catch {
      setError("Couldn't load phases")
    }
  }, [coachClientId])

  useEffect(() => { void load() }, [load])

  async function save(phase: ClientPhase, to: SettablePhaseStatus) {
    setSaving(true)
    setError(null)
    try {
      const res = await authFetch(`/api/coach/coach-clients/${coachClientId}/phases/${phase.phase_id}`, {
        method: "PATCH", body: JSON.stringify({ status: to }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) { setError(j?.error || "Couldn't save the phase"); return }
      setPhases(j.phases as ClientPhase[])
      setPicking(null)
      setConfirming(null)
    } catch {
      setError("Couldn't save the phase")
    } finally {
      setSaving(false)
    }
  }

  function choose(phase: ClientPhase, to: SettablePhaseStatus) {
    if (to === phase.status) { setPicking(null); return }
    if (isMoveBack(phase.status, to)) { setPicking(null); setConfirming({ phase, to }); return }
    void save(phase, to)
  }

  if (!coachClientId) return null
  const ready = (phases ?? []).filter((p) => p.ready_to_complete)

  return (
    <section style={{ ...card, padding: 22, marginBottom: 24 }} aria-label="Phase">
      <div style={{ ...eyebrow, color: NAVY, fontSize: TYPE.label, marginBottom: 14 }}>PHASE</div>
      {error && <div role="alert" style={{ fontSize: 12, color: "#B42318", marginBottom: 10 }}>{error}</div>}
      {!phases ? (
        !error && <p style={{ fontSize: 13, color: NAVY, margin: 0 }}>Loading phases…</p>
      ) : (
        <div style={{ overflowX: "auto", paddingBottom: 4 }}>
          <div style={{ display: "flex", alignItems: "flex-start", minWidth: "min-content" }}>
            {phases.map((p, i) => {
              const inPlan = p.status !== "not_in_plan"
              return (
                <Fragment key={p.phase_id}>
                  {i > 0 && (
                    <div aria-hidden style={{ flex: "0 0 28px", height: 2, marginTop: 15, background: "rgba(8,32,63,0.18)" }} />
                  )}
                  <button
                    type="button"
                    onClick={() => inPlan && setPicking(p)}
                    disabled={!inPlan || saving}
                    title={inPlan ? `Set the ${p.label} phase` : "Not in plan: no approved package has a deliverable in this phase"}
                    aria-label={`${p.label}: ${PHASE_STATUS_LABEL[p.status]}`}
                    style={{
                      flex: "0 0 auto", width: 112, display: "flex", flexDirection: "column", alignItems: "center", gap: 5,
                      background: "transparent", border: "none", padding: "0 4px", fontFamily: "inherit",
                      cursor: inPlan ? "pointer" : "default", opacity: inPlan ? 1 : 0.5,
                    }}
                  >
                    <span aria-hidden style={{
                      width: 32, height: 32, borderRadius: 999, display: "inline-flex", alignItems: "center",
                      justifyContent: "center", fontSize: 13, fontWeight: 900, boxSizing: "border-box", ...circleStyle(p.status),
                    }}>
                      {p.status === "complete" ? "✓" : i + 1}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 800, color: NAVY, textAlign: "center" }}>{p.label}</span>
                    <span style={{ fontSize: 11, color: NAVY, opacity: 0.8 }}>{PHASE_STATUS_LABEL[p.status]}</span>
                    {inPlan && (
                      <span style={{ fontSize: 11, color: NAVY, opacity: 0.8 }}>
                        {p.tasks_done} / {p.tasks_total} tasks
                      </span>
                    )}
                  </button>
                </Fragment>
              )
            })}
          </div>
        </div>
      )}
      {ready.map((p) => (
        <div key={p.phase_id} role="status" style={{
          marginTop: 12, fontSize: 12, color: NAVY, background: "rgba(0,179,179,0.10)",
          border: `1px solid ${PHASE_COLORS.complete}`, borderRadius: 8, padding: "8px 12px",
        }}>
          <strong>{p.label}:</strong> All tasks done, ready to mark complete.
        </div>
      ))}

      {picking && (
        <Dialog title={`${picking.label} phase`} onClose={() => setPicking(null)}>
          <p style={{ fontSize: 13, color: NAVY, margin: "0 0 12px" }}>
            Now: <strong>{PHASE_STATUS_LABEL[picking.status]}</strong> · {picking.tasks_done} / {picking.tasks_total} tasks done
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {SETTABLE_PHASE_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                disabled={saving}
                aria-pressed={picking.status === s}
                onClick={() => choose(picking, s)}
                style={{
                  padding: "8px 14px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                  ...circleStyle(s), ...(picking.status === s ? { boxShadow: "0 0 0 3px rgba(0,155,255,0.25)" } : {}),
                }}
              >
                {PHASE_STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </Dialog>
      )}

      {confirming && (
        <Dialog title="Move phase back" onClose={() => setConfirming(null)}>
          <p style={{ fontSize: 13, color: NAVY, margin: "0 0 16px" }}>
            Move <strong>{confirming.phase.label}</strong> back from {PHASE_STATUS_LABEL[confirming.phase.status]} to{" "}
            {PHASE_STATUS_LABEL[confirming.to]}?
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" onClick={() => setConfirming(null)} style={{
              padding: "8px 14px", borderRadius: 8, border: `1px solid ${NAVY}`, background: "#fff", color: NAVY,
              fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
            }}>Cancel</button>
            <button type="button" disabled={saving} onClick={() => void save(confirming.phase, confirming.to)} style={{
              padding: "8px 14px", borderRadius: 8, border: "none", background: NAVY, color: "#FEB06A",
              fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "inherit",
            }}>Move back</button>
          </div>
        </Dialog>
      )}
    </section>
  )
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(8,32,63,0.35)", display: "flex",
      alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16,
    }}>
      <div role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()} style={{
        background: "#fff", borderRadius: 12, padding: 20, width: "100%", maxWidth: 420, boxShadow: "0 16px 40px rgba(8,32,63,0.25)",
      }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: NAVY, marginBottom: 10 }}>{title}</div>
        {children}
      </div>
    </div>
  )
}
