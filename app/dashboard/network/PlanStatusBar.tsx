"use client"

// The Networking Plan's state, on every screen where a coach might look for it.
//
// WHY IT EXISTS. Plan state used to live in the import page's React state, so
// it survived only as long as the coach stayed on that page after an upload.
// Clicking through to the imported contacts lost it, and Build Networking Plan
// became unreachable without finding and uploading the workbook again. The bar
// reads the state from the server instead, so the next step is on screen
// wherever the coach is.
//
// IT RENDERS ON TWO DIFFERENTLY THEMED PAGES. The networking board is a
// converted light page (LIGHT from theme/surfaces); the import page is still
// on the dark dashboard theme. So the caller passes its tone and the bar takes
// its inks from the matching set, rather than hard-coding one and looking
// broken on the other.
//
// It renders NOTHING when there is no source. A client whose list has never
// been uploaded should not see an empty plan widget on their board.

import { useCallback, useEffect, useState } from "react"
import { T } from "../../../lib/dashboard-theme"
import { LIGHT, action as actionStyle } from "../../../lib/theme/surfaces"

type PlanStage = "no_source" | "ready_to_build" | "built" | "shared"

type Status = {
  stage: PlanStage
  source: { file_name: string | null; updated_at: string; hash: string } | null
  job: {
    id: string
    status: string
    step: string
    shared_at: string | null
    drive_file_url: string | null
    client_email_sent_at: string | null
    client_email_sent_count: number | null
    client_email_to: string | null
    client_email_error: string | null
    stale: boolean
  } | null
}

export type PlanStatusBarProps = {
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>
  tone: "light" | "dark"
  /** Bumped by the host page after an upload, so the bar re-reads. */
  refreshKey?: number
}

function formatDay(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "an unknown date"
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

export function PlanStatusBar({ authFetch, tone, refreshKey = 0 }: PlanStatusBarProps) {
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState<null | "build" | "share" | "resend">(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await authFetch("/api/network/plan/status")
      const j = await res.json().catch(() => null)
      if (!res.ok || !j?.ok) throw new Error(j?.error || `Status failed (${res.status})`)
      setStatus({ stage: j.stage, source: j.source, job: j.job })
    } catch (e: any) {
      setError(e?.message ?? String(e))
    }
  }, [authFetch])

  useEffect(() => { void load() }, [load, refreshKey])

  async function act(kind: "build" | "share" | "resend") {
    setBusy(kind)
    setError(null)
    setNote(null)
    try {
      // Build posts NO file: the rows come from the stored source. That is the
      // whole point of the bar being reachable away from the upload screen.
      const url =
        kind === "build" ? "/api/network/plan/run"
        : kind === "share" ? `/api/network/plan/${status?.job?.id}/share`
        : `/api/network/plan/${status?.job?.id}/resend`
      const res = await authFetch(url, { method: "POST" })
      const j = await res.json().catch(() => null)
      if (!res.ok || !j?.ok) throw new Error(j?.error || `That did not work (${res.status})`)
      if (kind === "resend") setNote(j.sent_to ? `Email re-sent to ${j.sent_to}.` : "Email re-sent.")
      await load()
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setBusy(null)
    }
  }

  if (!status || status.stage === "no_source") return null

  const { stage, source, job } = status
  const light = tone === "light"

  const ink = {
    bg: light ? LIGHT.card : T.CARD,
    border: light ? LIGHT.borderSoft : T.BORDER_SOFT,
    text: light ? LIGHT.text.primary : T.TEXT,
    muted: light ? LIGHT.text.muted : T.MUTED,
    dim: light ? LIGHT.text.dim : T.DIM,
    error: light ? LIGHT.meaning.error.ink : T.ERROR,
    ok: light ? LIGHT.meaning.replied.ink : T.TASK_DONE,
  }

  // The accent marks the rule and the eyebrow ONLY. It never fills a button:
  // orange at 2.7:1 is legible as a rule and not as a label, which is the rule
  // the JobFit surfaces are built on.
  const accent =
    stage === "shared" ? "#00B3B3"
    : stage === "built" ? "#009BFF"
    : "#FF6B00"

  const primaryStyle: React.CSSProperties = light
    ? { ...actionStyle(LIGHT, "primary"), padding: "8px 16px", fontSize: 13, fontWeight: 700 }
    : {
        padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 700,
        border: "none", background: T.WRN_ORANGE, color: T.INK_ON_ACCENT, cursor: "pointer",
      }

  const secondaryStyle: React.CSSProperties = {
    padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer",
    border: `1px solid ${ink.border}`, background: "transparent", color: ink.muted,
  }

  const btn = (label: string, kind: "build" | "share" | "resend", primary = true) => (
    <button
      onClick={() => void act(kind)}
      disabled={busy !== null}
      style={{ ...(primary ? primaryStyle : secondaryStyle), opacity: busy !== null ? 0.6 : 1 }}
    >
      {busy === kind ? "Working…" : label}
    </button>
  )

  return (
    <div
      style={{
        background: ink.bg,
        border: `1px solid ${ink.border}`,
        borderLeft: `3px solid ${accent}`,
        borderRadius: 10,
        padding: "14px 16px",
        marginBottom: 16,
        display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{
          fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase",
          color: accent, fontWeight: 700, marginBottom: 3,
        }}>
          Networking Plan
        </div>

        <div style={{ fontSize: 14, color: ink.text }}>
          {stage === "ready_to_build" && "A networking list is uploaded. The plan has not been built yet."}
          {stage === "built" && "Plan built and filed in the library, hidden from the client."}
          {stage === "shared" && job?.shared_at && `Shared on ${formatDay(job.shared_at)}.`}
        </div>

        <div style={{ fontSize: 12, color: ink.dim, marginTop: 3 }}>
          {source?.file_name ? `From ${source.file_name}. ` : ""}
          {/* Said plainly, because outside production the recipient is not the
              client and a bar claiming otherwise would be lying. */}
          {stage === "shared" && job?.client_email_to ? `Email sent to ${job.client_email_to}. ` : ""}
          {stage === "shared" && !job?.client_email_sent_at ? "No email has been sent for this plan. " : ""}
          {job?.stale ? "A newer list has been uploaded since this plan was built." : ""}
        </div>

        {job?.client_email_error && (
          <div style={{ fontSize: 12, color: ink.error, marginTop: 4 }}>
            Last email failed: {job.client_email_error}
          </div>
        )}
        {error && <div style={{ fontSize: 12, color: ink.error, marginTop: 4 }}>{error}</div>}
        {note && <div style={{ fontSize: 12, color: ink.ok, marginTop: 4 }}>{note}</div>}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {stage === "ready_to_build" && btn("Build Networking Plan", "build")}
        {stage === "built" && (
          <>
            {btn("Share with Client", "share")}
            {btn("Rebuild plan", "build", false)}
          </>
        )}
        {stage === "shared" && (
          <>
            {btn("Re-send email", "resend")}
            {btn("Rebuild plan", "build", false)}
          </>
        )}
        {job?.drive_file_url && (
          <a
            href={job.drive_file_url} target="_blank" rel="noopener noreferrer"
            style={{ ...secondaryStyle, textDecoration: "none", display: "inline-flex", alignItems: "center" }}
          >
            Open PDF
          </a>
        )}
      </div>
    </div>
  )
}
